/**
 * Offline engine for مخزوني مهدي عوض
 *
 * 1. React Query persister  — all query results cached in IndexedDB.
 *    The app shows stale cached data when offline instead of blank screens.
 *
 * 2. Mutation queue         — POST/PATCH/DELETE recorded when offline.
 *    Flushed automatically when the connection is restored.
 */

import { get, set, del, createStore } from "idb-keyval"
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client"

// ─── IndexedDB stores ────────────────────────────────────────────────────────

const queryStore = createStore("makhzouni-query-cache", "queries")
const mutationStore = createStore("makhzouni-mutation-queue", "mutations")

// ─── React Query persister ───────────────────────────────────────────────────

export const idbPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    await set("client", client, queryStore)
  },
  restoreClient: async () => {
    return await get<PersistedClient>("client", queryStore)
  },
  removeClient: async () => {
    await del("client", queryStore)
  },
}

// ─── Mutation queue ──────────────────────────────────────────────────────────

export interface QueuedMutation {
  id: string
  method: "POST" | "PATCH" | "PUT" | "DELETE"
  url: string
  data?: unknown
  timestamp: number
  label: string
}

export async function enqueueMutation(mutation: Omit<QueuedMutation, "id" | "timestamp">) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const item: QueuedMutation = { ...mutation, id, timestamp: Date.now() }
  const queue = await loadQueue()
  queue.push(item)
  await set("queue", queue, mutationStore)
  window.dispatchEvent(new CustomEvent("makhzouni:queue-change", { detail: queue.length }))
  return id
}

export async function loadQueue(): Promise<QueuedMutation[]> {
  return (await get<QueuedMutation[]>("queue", mutationStore)) ?? []
}

export async function removeFromQueue(id: string) {
  const queue = await loadQueue()
  const filtered = queue.filter((m) => m.id !== id)
  await set("queue", filtered, mutationStore)
  window.dispatchEvent(new CustomEvent("makhzouni:queue-change", { detail: filtered.length }))
}

export async function clearQueue() {
  await set("queue", [], mutationStore)
  window.dispatchEvent(new CustomEvent("makhzouni:queue-change", { detail: 0 }))
}

// ─── Queue flusher ───────────────────────────────────────────────────────────

import axios from "axios"

export async function flushMutationQueue(baseUrl: string, token: string): Promise<{
  sent: number
  failed: number
  errors: string[]
}> {
  const queue = await loadQueue()
  if (queue.length === 0) return { sent: 0, failed: 0, errors: [] }

  let sent = 0
  let failed = 0
  const errors: string[] = []

  for (const mutation of queue) {
    try {
      const url = mutation.url.startsWith("http") ? mutation.url : `${baseUrl}${mutation.url}`
      await axios({
        method: mutation.method,
        url,
        data: mutation.data,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        timeout: 15000,
      })
      await removeFromQueue(mutation.id)
      sent++
    } catch (err: unknown) {
      failed++
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      errors.push(`${mutation.label}: ${msg ?? "فشل الاتصال"}`)
    }
  }

  return { sent, failed, errors }
}
