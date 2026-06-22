import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { API_BASE_URL } from "../api/client"

type RealtimeResource =
  | "all"
  | "approvals"
  | "audit-logs"
  | "branches"
  | "catalog"
  | "coupons"
  | "customers"
  | "invoices"
  | "notifications"
  | "order-preparations"
  | "products"
  | "quotations"
  | "reports"
  | "settings"
  | "stock-losses"
  | "stocktake"
  | "transfers"
  | "users"
  | "vouchers"

type RealtimeEvent = {
  type: "connected" | "changed"
  resource: RealtimeResource
  at: string
}

const queryKeysByResource: Record<RealtimeResource, string[]> = {
  all: [],
  approvals: ["approvals"],
  "audit-logs": ["audit-logs"],
  branches: ["branches", "branch-summaries"],
  catalog: ["catalog-customers", "catalog-categories", "retail-catalog", "public-catalog"],
  coupons: ["coupons"],
  customers: ["customers", "customer", "customer-transactions", "customer-balance", "debts"],
  invoices: ["invoices", "invoice", "dashboard-report", "reports", "customers", "products"],
  notifications: ["notifications"],
  "order-preparations": ["order-preparations", "approvals"],
  products: ["products", "product", "product-movement", "dashboard-report", "reports"],
  quotations: ["quotations"],
  reports: ["reports", "dashboard-report"],
  settings: ["settings", "message-templates", "whatsapp-status"],
  "stock-losses": ["stock-losses", "products", "product", "product-movement", "dashboard-report", "reports"],
  stocktake: ["stocktake", "stocktake-sessions", "stocktake-session", "products"],
  transfers: ["transfers", "products", "branches"],
  users: ["users"],
  vouchers: ["vouchers", "voucher", "customers", "dashboard-report", "reports"],
}

function realtimeUrl(token: string) {
  const configuredBase = String(import.meta.env.VITE_REALTIME_API_URL ?? "").trim()
  const base = (
    configuredBase ||
    (API_BASE_URL.startsWith("http")
      ? API_BASE_URL
      : "https://inventory-backend-production-7e85.up.railway.app/api")
  ).replace(/\/$/, "")
  return `${base}/realtime/events?token=${encodeURIComponent(token)}`
}

const MIN_RECONNECT_MS = 3_000
const MAX_RECONNECT_MS = 30_000

export function RealtimeSyncBridge() {
  const queryClient = useQueryClient()
  const eventSourceRef = useRef<EventSource | null>(null)
  const tokenRef = useRef<string | null>(null)
  const invalidationTimer = useRef<number | null>(null)
  const pendingResources = useRef<Set<RealtimeResource>>(new Set())
  const reconnectBackoff = useRef<number>(MIN_RECONNECT_MS)
  const nextRetryAt = useRef<number>(0)

  useEffect(() => {
    function invalidate(resource: RealtimeResource) {
      pendingResources.current.add(resource)
      if (invalidationTimer.current != null) return

      invalidationTimer.current = window.setTimeout(() => {
        const resources = Array.from(pendingResources.current)
        pendingResources.current.clear()
        invalidationTimer.current = null

        if (resources.includes("all")) {
          void queryClient.invalidateQueries()
          return
        }

        const keys = new Set(resources.flatMap((item) => queryKeysByResource[item] ?? []))
        if (keys.size === 0) {
          void queryClient.invalidateQueries()
          return
        }

        keys.forEach((key) => {
          void queryClient.invalidateQueries({ queryKey: [key] })
        })
      }, 300)
    }

    function closeCurrent() {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }

    function connectIfNeeded() {
      const token = localStorage.getItem("inventory_token")
      if (!token) {
        tokenRef.current = null
        closeCurrent()
        return
      }
      if (tokenRef.current === token && eventSourceRef.current) return
      // Respect exponential backoff after a failed connection
      if (Date.now() < nextRetryAt.current) return

      tokenRef.current = token
      closeCurrent()

      const source = new EventSource(realtimeUrl(token))
      eventSourceRef.current = source

      // "connected" is just a handshake — do NOT invalidate here.
      // The page already loaded fresh data; invalidating "all" on every
      // (re)connect caused a refetch storm + flicker when the SSE connection
      // dropped and reconnected repeatedly under server load.
      source.addEventListener("connected", () => {
        reconnectBackoff.current = MIN_RECONNECT_MS
      })

      source.addEventListener("changed", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as RealtimeEvent
          invalidate(payload.resource)
        } catch {
          invalidate("all")
        }
      })

      source.onerror = () => {
        source.close()
        if (eventSourceRef.current === source) eventSourceRef.current = null
        // Back off so a struggling server isn't hammered every 2s
        nextRetryAt.current = Date.now() + reconnectBackoff.current
        reconnectBackoff.current = Math.min(reconnectBackoff.current * 2, MAX_RECONNECT_MS)
      }
    }

    connectIfNeeded()
    const interval = window.setInterval(connectIfNeeded, 2_000)
    window.addEventListener("focus", connectIfNeeded)
    window.addEventListener("storage", connectIfNeeded)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", connectIfNeeded)
      window.removeEventListener("storage", connectIfNeeded)
      if (invalidationTimer.current != null) window.clearTimeout(invalidationTimer.current)
      closeCurrent()
    }
  }, [queryClient])

  return null
}
