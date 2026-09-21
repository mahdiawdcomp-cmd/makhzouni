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
  // «approvals» too: a rep's invoice edit publishes «invoices» whether it was
  // applied or queued, and a queued one lands in the approvals screen.
  invoices: ["invoices", "invoice", "dashboard-report", "reports", "customers", "products", "approvals"],
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
  // No dedicated chat UI in desktop (web-only feature) — just refresh the
  // provider status/usage counters shown in the send-channel picker. An
  // empty array here would still fall through to invalidateQueries() with
  // no filter (empty key set == "unknown resource" to invalidate()), so a
  // real, cheap key is needed to avoid that.
  "whatsapp-chat": ["whatsapp-status"],
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
 * Same rule as the web: without it the bell and «إشعارات المندوبين» waited on
 * their own poll after every invoice or voucher, and read wrong meanwhile.
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
  ["approvals-pending-count"],
]

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

const FULL_REFRESH_MIN_GAP_MS = 10_000
// Boot-time config no staff mutation changes; refetching it on every broadcast
// only adds requests.
const STATIC_QUERY_ROOTS = new Set(["tenant-config", "license-status"])

export function RealtimeSyncBridge() {
  const queryClient = useQueryClient()
  const eventSourceRef = useRef<EventSource | null>(null)
  const tokenRef = useRef<string | null>(null)
  const invalidationTimer = useRef<number | null>(null)
  const pendingResources = useRef<Set<RealtimeResource>>(new Set())
  const lastFullRefreshAt = useRef<number>(0)
  const deferredFullRefresh = useRef<number | null>(null)

  useEffect(() => {
    // Same guard as web: an unfiltered refresh that re-triggers itself became a
    // request storm (429 lockout). Coalesce to one per window, keep the last
    // one, and leave the heavy products query / static boot config out.
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

      tokenRef.current = token
      closeCurrent()

      const source = new EventSource(realtimeUrl(token))
      eventSourceRef.current = source

      source.addEventListener("connected", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as RealtimeEvent
          invalidate(payload.resource)
        } catch {
          invalidate("all")
        }
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
      }
    }

    // Money-data safety net: refresh balance-bearing resources when the user
    // returns to this window, so vouchers/invoices made elsewhere never show stale.
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
