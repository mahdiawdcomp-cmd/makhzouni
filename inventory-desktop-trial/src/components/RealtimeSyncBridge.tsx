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
  | "prep-screen"
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
  // «approvals» too: a rep's invoice edit publishes «invoices» whether it was
  // applied or queued, and a queued one lands in the approvals screen.
  invoices: ["invoices", "invoice", "dashboard-report", "reports", "customers", "products", "approvals"],
  notifications: ["notifications"],
  "order-preparations": ["order-preparations", "approvals"],
  "prep-screen": ["prep-screen"],
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

// The rep's screens live under ["sales-agent", <name>], so none of the generic
// keys above ever reached them: a sale, a stock change or a voucher left the
// rep's catalogue, cash and receipts stale for the whole 5-minute staleTime.
// Only the queries a resource can actually change are listed. Thumbnails and
// full images are deliberately absent: they are static per product and heavy.
const salesAgentKeysByResource: Partial<Record<RealtimeResource, string[]>> = {
  products: ["products", "usable-prices"],
  invoices: ["products", "customers", "customer-header", "customer-detail", "today", "usual-products"],
  "stock-losses": ["products"],
  stocktake: ["products"],
  transfers: ["products"],
  customers: ["customers", "customer-header", "customer-detail", "visit-customers", "visit-plan", "area-rows", "areas"],
  vouchers: ["cash", "today", "receipts", "handovers", "customers", "customer-header", "customer-detail"],
  approvals: ["orders", "today", "price-requests", "issues"],
  "order-preparations": ["orders", "today"],
  catalog: ["products", "customer-offers"],
}

/**
 * Resources whose writes CREATE notifications, and the queries that show them.
 *
 * The bell and «إشعارات المندوبين» are fed by rows written inside ordinary
 * saves — an invoice, a voucher, a rep's order. Only the «notifications»
 * resource used to refresh them, and that fires when someone marks a
 * notification read, not when one is created. So the counter sat stale until
 * its own 30-second poll, and looked wrong in the meantime.
 */
const NOTIFYING_RESOURCES = new Set<RealtimeResource>([
  "approvals",
  "customers",
  "invoices",
  "notifications",
  "order-preparations",
  "products",
  "vouchers",
])
const NOTIFICATION_QUERY_KEYS: string[][] = [
  ["notifications", "recent"],
  ["app-notifications"],
  ["app-notification-counts"],
  ["sales-agent-admin", "activity"],
  ["sales-agent-admin", "activity-counts"],
  // The sidebar's approvals badge. Its key does not start with «approvals»,
  // so the approvals rule above never reached it either.
  ["approvals-pending-count"],
]

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

const FULL_REFRESH_MIN_GAP_MS = 10_000
// Boot-time config no staff mutation changes; refetching it on every broadcast
// only adds requests.
const STATIC_QUERY_ROOTS = new Set(["tenant-config", "license-status"])

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

  const lastFullRefreshAt = useRef<number>(0)
  const deferredFullRefresh = useRef<number | null>(null)

  useEffect(() => {
    // An unfiltered refresh refetches every active query. If whatever triggers
    // it is itself a side effect of refetching (a page that re-requests data on
    // refetch and a server that broadcasts that request), the two feed each
    // other several times a second — that loop locked every shop device out
    // with 429s. Coalesce to at most one per window, never drop the last one,
    // and leave the heavy products query / static boot config out of it.
    function invalidateEverything() {
      const wait = lastFullRefreshAt.current + FULL_REFRESH_MIN_GAP_MS - Date.now()
      if (wait > 0) {
        if (deferredFullRefresh.current == null) {
          deferredFullRefresh.current = window.setTimeout(() => {
            deferredFullRefresh.current = null
            invalidateEverything()
          }, wait)
        }
        return
      }
      lastFullRefreshAt.current = Date.now()
      void queryClient.invalidateQueries({
        predicate: (query) => !STATIC_QUERY_ROOTS.has(String(query.queryKey[0])) && query.queryKey[0] !== "products",
      })
      void queryClient.invalidateQueries({ queryKey: ["products"], refetchType: "none" })
    }

    function invalidate(resource: RealtimeResource) {
      pendingResources.current.add(resource)
      if (invalidationTimer.current != null) return

      invalidationTimer.current = window.setTimeout(() => {
        const resources = Array.from(pendingResources.current)
        pendingResources.current.clear()
        invalidationTimer.current = null

        if (resources.includes("all")) {
          invalidateEverything()
          return
        }

        if (resources.some((item) => NOTIFYING_RESOURCES.has(item))) {
          for (const queryKey of NOTIFICATION_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey })
        }

        const salesAgentKeys = new Set(resources.flatMap((item) => salesAgentKeysByResource[item] ?? []))
        if (salesAgentKeys.size > 0) {
          void queryClient.invalidateQueries({
            predicate: (query) => query.queryKey[0] === "sales-agent" && salesAgentKeys.has(String(query.queryKey[1])),
          })
        }

        const keys = new Set(resources.flatMap((item) => queryKeysByResource[item] ?? []))
        if (keys.size === 0) {
          invalidateEverything()
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
      if (deferredFullRefresh.current != null) window.clearTimeout(deferredFullRefresh.current)
      closeCurrent()
    }
  }, [queryClient])

  return null
}
