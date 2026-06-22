/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching"

declare let self: ServiceWorkerGlobalScope

type SyncEvent = ExtendableEvent & { tag: string }

const APP_CACHE = "inventory-app-v1"
const API_CACHE = "inventory-api-v1"
const QUEUE_DB = "inventory-pwa-queue"
const QUEUE_STORE = "requests"
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const QUEUEABLE_API_PREFIXES = [
  "/api/invoices",
  "/api/vouchers",
  "/api/products",
  "/api/customers",
  "/api/transfers",
]

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

type QueuedRequest = {
  id?: number
  url: string
  method: string
  headers: [string, string][]
  body: string
  createdAt: string
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function storeQueuedRequest(item: QueuedRequest) {
  const db = await openQueueDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite")
    tx.objectStore(QUEUE_STORE).add(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  await notifyClients()
}

async function listQueuedRequests(): Promise<QueuedRequest[]> {
  const db = await openQueueDb()
  const rows = await new Promise<QueuedRequest[]>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly")
    const request = tx.objectStore(QUEUE_STORE).getAll()
    request.onsuccess = () => resolve(request.result as QueuedRequest[])
    request.onerror = () => reject(request.error)
  })
  db.close()
  return rows
}

async function deleteQueuedRequest(id: number) {
  const db = await openQueueDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite")
    tx.objectStore(QUEUE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function queueCount() {
  return (await listQueuedRequests()).length
}

async function notifyClients() {
  const count = await queueCount()
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" })
  for (const client of clients) {
    client.postMessage({ type: "PWA_QUEUE_COUNT", count })
  }
}

async function postToClients(message: Record<string, unknown>) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" })
  for (const client of clients) client.postMessage(message)
}

async function replayQueue(authToken?: string) {
  const rows = await listQueuedRequests()
  let synced = 0
  let authBlocked = false
  const failed: Array<{ url: string; method: string; status: number; message?: string }> = []

  for (const row of rows) {
    let response: Response
    try {
      const headers = new Headers(row.headers)
      if (authToken) headers.set("Authorization", `Bearer ${authToken}`)
      response = await fetch(row.url, {
        method: row.method,
        headers,
        body: row.body || undefined,
        credentials: "include",
      })
    } catch {
      // Network still down — keep this and the rest queued, retry next time.
      break
    }

    if (response.ok || response.status === 201 || response.status === 202) {
      if (row.id !== undefined) await deleteQueuedRequest(row.id)
      synced++
      continue
    }

    if (response.status === 401 || response.status === 403) {
      // Session expired / not authorised. Do NOT drop — these replay fine after
      // the user logs back in. Stop here and tell the app to prompt re-login.
      authBlocked = true
      break
    }

    if (response.status === 409 || response.status === 429 || response.status >= 500) {
      // Conflict / rate-limited / server error: transient or order-dependent.
      // Keep queued (preserve order) and retry on the next sync.
      break
    }

    if (response.status >= 400) {
      // Genuinely rejected (validation / not-found). Remove so the queue can't get
      // stuck forever, but REPORT it so the user knows this entry didn't save.
      let message: string | undefined
      try {
        const body = (await response.clone().json()) as { message?: string; error?: string }
        message = body.message ?? body.error
      } catch {
        message = undefined
      }
      if (row.id !== undefined) await deleteQueuedRequest(row.id)
      failed.push({ url: row.url, method: row.method, status: response.status, message })
    }
  }

  await notifyClients()
  if (synced > 0) await postToClients({ type: "PWA_SYNC_DONE", synced })
  if (failed.length > 0) await postToClients({ type: "PWA_SYNC_FAILED", failed })
  if (authBlocked) await postToClients({ type: "PWA_SYNC_AUTH" })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

async function cacheFirstApp(request: Request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function networkFirstApi(request: Request) {
  const cache = await caches.open(API_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && request.method === "GET") {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    return cached ?? jsonResponse({ success: false, offline: true, message: "لا يوجد اتصال ولا توجد نسخة محفوظة" }, 503)
  }
}

async function queueMutation(request: Request) {
  try {
    return await fetch(request.clone())
  } catch {
    await storeQueuedRequest({
      url: request.url,
      method: request.method,
      headers: Array.from(request.headers.entries()).filter(([key]) => key.toLowerCase() !== "content-length"),
      body: await request.clone().text(),
      createdAt: new Date().toISOString(),
    })
    return jsonResponse({
      success: true,
      queued: true,
      message: "تم حفظ العملية محلياً وستُزامن عند رجوع الإنترنت",
    }, 202)
  }
}

function isQueueableMutation(pathname: string) {
  return QUEUEABLE_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

self.addEventListener("install", () => {
  // Don't auto-skip waiting — user triggers update via the banner button
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim().then(notifyClients))
})

self.addEventListener("online", () => {
  void replayQueue()
})

self.addEventListener("sync", (event) => {
  const syncEvent = event as SyncEvent
  if (syncEvent.tag === "inventory-sync") {
    syncEvent.waitUntil(replayQueue())
  }
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting()
  }
  if (event.data?.type === "PWA_SYNC_NOW") {
    event.waitUntil(replayQueue(
      typeof event.data.token === "string" && event.data.token ? event.data.token : undefined,
    ))
  }
  if (event.data?.type === "PWA_QUEUE_COUNT_REQUEST") {
    event.waitUntil(notifyClients())
  }
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith("/api/")) {
    if (MUTATING_METHODS.has(request.method)) {
      event.respondWith(
        isQueueableMutation(url.pathname)
          ? queueMutation(request)
          : fetch(request).catch(() =>
              jsonResponse({ success: false, offline: true, message: "لا يمكن تنفيذ هذه العملية بدون إنترنت" }, 503),
            ),
      )
      return
    }
    event.respondWith(networkFirstApi(request))
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(APP_CACHE)
        return (await cache.match("/index.html")) ?? Response.error()
      }),
    )
    return
  }

  if (request.method === "GET") {
    event.respondWith(cacheFirstApp(request))
  }
})

// ── Push notifications (product arrival alerts) ────────────────────────────
self.addEventListener("push", (event) => {
  let payload: { title?: string; body?: string; url?: string } = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { title: "إشعار جديد", body: event.data?.text() ?? "" }
  }

  const title = payload.title ?? "مخزوني"
  const options: NotificationOptions = {
    body: payload.body ?? "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    dir: "rtl",
    lang: "ar",
    data: { url: payload.url ?? "/" },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url: string = event.notification.data?.url ?? "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url))
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    })
  )
})
