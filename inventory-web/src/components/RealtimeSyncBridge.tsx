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
  | "whatsapp-chat"

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
  "whatsapp-chat": ["whatsapp-conversations", "whatsapp-messages", "whatsapp-unread-count"],
}

function realtimeUrl(token: string): string | null {
  const configuredBase = String(import.meta.env.VITE_REALTIME_API_URL ?? "").trim()
  // Fail-closed: only open an SSE connection against an ABSOLUTE backend base
  // (VITE_REALTIME_API_URL, or the runtime-resolved API_BASE_URL once it points
  // at the tenant's own backend). Previously this fell back to a hardcoded
  // backend when API_BASE_URL was still relative — that could route realtime
  // traffic to the wrong tenant. No hardcoded fallback: if there's no absolute
  // base we simply don't connect.
  const base = (
    configuredBase ||
    (API_BASE_URL.startsWith("http") ? API_BASE_URL : "")
  ).replace(/\/$/, "")
  if (!base) return null
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
          void queryClient.invalidateQueries({
          queryKey: [key],
          // `products` is the ~4.75 MB catalogue query and almost every
          // resource maps to it, so an immediate refetch meant every sale made
          // every open tab re-download it. Mark it stale instead and let the
          // next navigation reconcile — which is exactly what useProducts'
          // own mutations do.
          refetchType: key === "products" ? "none" : undefined,
        })
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

      const url = realtimeUrl(token)
      if (!url) {
        // No absolute backend base resolved yet — skip realtime (fail-closed,
        // never route SSE traffic to a hardcoded/other-tenant backend).
        return
      }
      const source = new EventSource(url)
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

    // Money-data safety net: refetchOnWindowFocus is globally off (SSE covers
    // cross-tab sync), but SSE can be disconnected (fail-closed base, backoff
    // window, dropped events during reconnect). When the user switches back to
    // this tab, refresh the balance-bearing resources so a voucher/invoice made
    // in another tab is never shown stale — this was perceived as «السند ما
    // انحسب» until a second operation forced a refetch.
    function refreshMoneyDataOnReturn() {
      if (document.visibilityState !== "visible") return
      invalidate("vouchers")
      invalidate("customers")
      invalidate("invoices")
    }

    connectIfNeeded()
    const interval = window.setInterval(connectIfNeeded, 2_000)
    window.addEventListener("focus", connectIfNeeded)
    window.addEventListener("storage", connectIfNeeded)
    document.addEventListener("visibilitychange", refreshMoneyDataOnReturn)
    window.addEventListener("focus", refreshMoneyDataOnReturn)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", connectIfNeeded)
      window.removeEventListener("storage", connectIfNeeded)
      document.removeEventListener("visibilitychange", refreshMoneyDataOnReturn)
      window.removeEventListener("focus", refreshMoneyDataOnReturn)
      if (invalidationTimer.current != null) window.clearTimeout(invalidationTimer.current)
      closeCurrent()
    }
  }, [queryClient])

  return null
}
