import { useEffect, useSyncExternalStore } from "react"
import { getPrepThumbs } from "../api/endpoints"

// Product pictures for the prep screen. Snapshots from the server carry no
// pictures (they are ~10 KB data URLs and the screens poll every 1.5 s), so
// each product's picture is fetched once, batched, and kept for the session.

const cache = new Map<string, string | null>()
const listeners = new Set<() => void>()
let queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

/** Line keys are `${productId}-${unit}` (+ `#n`); the id is a UUID. */
export function productIdOfKey(key: string) {
  return key.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null
}

async function flush() {
  timer = null
  const ids = [...queue]
  queue = new Set()
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60)
    try {
      const got = await getPrepThumbs(chunk)
      for (const id of chunk) cache.set(id, got[id] ?? null)
    } catch {
      // Offline / signed out — leave uncached so a later render retries.
    }
  }
  listeners.forEach((l) => l())
}

function request(id: string) {
  if (cache.has(id) || queue.has(id)) return
  queue.add(id)
  timer ??= setTimeout(flush, 50)
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** The line's own picture if it has one, else the product's fetched thumbnail. */
export function usePrepThumb(line: { key: string; imageUrl: string | null }) {
  const id = line.imageUrl ? null : productIdOfKey(line.key)
  const fetched = useSyncExternalStore(subscribe, () => (id ? cache.get(id) : undefined))
  useEffect(() => { if (id) request(id) }, [id])
  return line.imageUrl ?? fetched ?? null
}
