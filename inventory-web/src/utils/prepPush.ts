import { getPrepVapidKey, subscribePrepPush } from "../api/endpoints"

// «إشعارات التجهيز» — subscribe this phone's browser to the prep pushes.
// Shared by the worker page and the prep screen. Returns null on success or a
// short English message (the workers don't read Arabic).

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported"
}

export async function enablePrepPush(): Promise<string | null> {
  if (!pushSupported()) return "This browser does not support notifications. Open the site in Chrome."
  const perm = await Notification.requestPermission()
  if (perm !== "granted") return "Notifications are blocked. Chrome → ⋮ → Settings → Site settings → Notifications → allow this site."
  try {
    const key = await getPrepVapidKey()
    if (!key) return "Notifications are not configured on the server."
    // `ready` never settles when no service worker is registered — don't hang the button.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ])
    if (!reg) return "App not installed yet — reload the page once and try again."
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }))
    await subscribePrepPush(sub.toJSON())
    return null
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    return status === 403 ? "This account has no «إشعارات التجهيز» permission." : "Could not enable notifications."
  }
}
