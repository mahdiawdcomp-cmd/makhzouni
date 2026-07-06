import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Bell,
  FileText,
  Package,
  PackageMinus,
  Pencil,
  Receipt,
  ReceiptText,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  TrendingDown,
  UserPlus,
  Wallet,
} from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../ui/button"
import { cn } from "../../utils/cn"

interface NotificationActor { id: string; name: string; role: string }
interface Notification {
  id: string
  createdAt: string
  severity: "info" | "success" | "warning" | "error"
  icon: string
  title: string
  message: string
  link?: string
  actor?: NotificationActor
}

// New AppNotification center rows (batch 23C).
interface AppNotification {
  id: string
  type: string
  category: string
  severity: "IMPORTANT" | "MEDIUM" | "NORMAL"
  title: string
  message: string
  entityType?: string | null
  entityId?: string | null
  actionUrl?: string | null
  count: number
  readAt?: string | null
  createdAt: string
}

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  Receipt, ReceiptText, ShoppingCart, ShoppingBag, Wallet, Package, PackageMinus, Pencil, Trash2, FileText, UserPlus, TrendingDown, AlertTriangle,
}

const severityStyles: Record<Notification["severity"], { dot: string; row: string }> = {
  success: { dot: "bg-emerald-500", row: "bg-emerald-50/60 dark:bg-emerald-950/20" },
  warning: { dot: "bg-amber-500",   row: "bg-amber-50/60 dark:bg-amber-950/20" },
  error:   { dot: "bg-rose-500",    row: "bg-rose-50/60 dark:bg-rose-950/20" },
  info:    { dot: "bg-sky-500",     row: "bg-sky-50/60 dark:bg-sky-950/20" },
}

// Map an AppNotification severity onto the shared colour vocabulary + Arabic label.
const appSeverityStyle: Record<AppNotification["severity"], { dot: string; row: string; label: string; badge: string }> = {
  IMPORTANT: { dot: "bg-rose-500",  row: "bg-rose-50/60 dark:bg-rose-950/20",  label: "مهم",   badge: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  MEDIUM:    { dot: "bg-amber-500", row: "bg-amber-50/60 dark:bg-amber-950/20", label: "متوسط", badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  NORMAL:    { dot: "bg-sky-500",   row: "bg-sky-50/60 dark:bg-sky-950/20",     label: "عادي",  badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
}

const CATEGORY_LABEL: Record<string, string> = {
  IMPORTANT: "مهم",
  NEGATIVE_SALE: "بيع سالب / بخسارة",
  INVOICES: "فواتير",
  APPROVALS: "موافقات",
  STOCK: "مخزون",
  CUSTOMERS_DEBT: "زبائن وديون",
  WHATSAPP: "واتساب",
  SYSTEM: "نظام",
}

// Tab keys: "ALL" = everything, "IMPORTANT" filters by severity, the rest by category.
const TABS: Array<{ key: string; label: string }> = [
  { key: "ALL", label: "الكل" },
  { key: "IMPORTANT", label: "مهم" },
  { key: "NEGATIVE_SALE", label: "بيع سالب / بخسارة" },
  { key: "INVOICES", label: "فواتير" },
  { key: "APPROVALS", label: "موافقات" },
  { key: "STOCK", label: "مخزون" },
  { key: "CUSTOMERS_DEBT", label: "زبائن وديون" },
  { key: "WHATSAPP", label: "واتساب" },
  { key: "SYSTEM", label: "نظام" },
]

async function fetchRecent(): Promise<Notification[]> {
  const { data } = await api.get<{ success: boolean; data: Notification[] }>("/notifications/recent", { params: { limit: 30 } })
  return data.data ?? []
}

async function fetchAppNotifications(): Promise<{ items: AppNotification[]; unreadCount: number }> {
  const { data } = await api.get<{ success: boolean; items: AppNotification[]; unreadCount: number }>(
    "/notifications/app/recent",
    { params: { limit: 50 } },
  )
  return { items: data.items ?? [], unreadCount: data.unreadCount ?? 0 }
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const sec = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (sec < 60)      return `قبل ${sec} ثانية`
  const min = Math.floor(sec / 60)
  if (min < 60)      return `قبل ${min} دقيقة`
  const hr = Math.floor(min / 60)
  if (hr < 24)       return `قبل ${hr} ساعة`
  const days = Math.floor(hr / 24)
  if (days < 7)      return `قبل ${days} يوم`
  return new Date(iso).toLocaleDateString("en-US")
}

export function NotificationsBell() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("ALL")
  const ref = useRef<HTMLDivElement | null>(null)
  const firstLoadRef = useRef(true)

  function openNotification(path: string) {
    if (location.pathname === "/invoices/new") window.open(path, "_blank", "noopener,noreferrer")
    else navigate(path)
  }

  // Legacy derived feed (AuditLog / PendingApproval) — kept as a fallback so
  // existing events (new invoice, approvals, ...) don't disappear before 23E.
  const { data: legacy = [] } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: fetchRecent,
    refetchInterval: 30_000,
  })

  // New AppNotification center feed (structured, server read/unread).
  const { data: appData } = useQuery({
    queryKey: ["app-notifications"],
    queryFn: fetchAppNotifications,
    refetchInterval: 30_000,
  })
  const appItems = appData?.items ?? []
  const appUnread = appData?.unreadCount ?? 0

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/app/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app-notifications"] }),
  })
  const markAllApp = useMutation({
    mutationFn: () => api.post("/notifications/app/mark-all-read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app-notifications"] }),
  })

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  // Legacy "unread" = anything newer than the last-seen timestamp (localStorage).
  const [seenAt, setSeenAt] = useState<number>(() => {
    try { return Number(localStorage.getItem("notif_seen_at") || 0) } catch { return 0 }
  })
  const legacyUnread = legacy.filter((n) => new Date(n.createdAt).getTime() > seenAt).length
  const unreadCount = appUnread + legacyUnread

  // Sound + browser push for the legacy feed only (unchanged). Multi-tone,
  // per-category sound for AppNotification comes later (batch 23F).
  useEffect(() => {
    if (!legacy.length) return
    const newest = legacy[0]
    const newestTime = new Date(newest.createdAt).getTime()
    if (!Number.isFinite(newestTime)) return

    const lastPushed = Number(localStorage.getItem("notif_last_push_at") || 0)
    if (firstLoadRef.current) {
      firstLoadRef.current = false
      localStorage.setItem("notif_last_push_at", String(Math.max(lastPushed, newestTime)))
      return
    }
    if (newestTime <= lastPushed) return

    localStorage.setItem("notif_last_push_at", String(newestTime))
    playNotificationTone()

    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification(newest.title, {
        body: newest.message,
        icon: "/pwa-icon.svg",
        badge: "/pwa-icon.svg",
        tag: newest.id,
        requireInteraction: newest.severity === "error",
      })
      notification.onclick = () => {
        window.focus()
        if (newest.link) openNotification(newest.link)
      }
    }
  }, [legacy, location.pathname, navigate])

  function markSeen() {
    const now = Date.now()
    setSeenAt(now)
    try { localStorage.setItem("notif_seen_at", String(now)) } catch {}
    markAllApp.mutate()
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) return
    if (Notification.permission === "default") {
      await Notification.requestPermission()
    }
  }

  // Which AppNotifications belong to the active tab.
  const visibleApp = useMemo(() => {
    if (activeTab === "ALL") return appItems
    if (activeTab === "IMPORTANT") return appItems.filter((n) => n.severity === "IMPORTANT")
    return appItems.filter((n) => n.category === activeTab)
  }, [appItems, activeTab])

  // Legacy items only surface under "الكل".
  const showLegacy = activeTab === "ALL"
  const isEmpty = visibleApp.length === 0 && (!showLegacy || legacy.length === 0)

  function onOpenAppItem(n: AppNotification) {
    if (!n.readAt) markOne.mutate(n.id)
    if (n.actionUrl) {
      openNotification(n.actionUrl)
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        className="relative px-3"
        aria-label="الإشعارات"
        onClick={() => { setOpen((v) => !v); if (!open) { markSeen(); void enableBrowserNotifications() } }}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 max-h-[75vh] w-96 max-w-[92vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-700">
            <div className="text-sm font-semibold">مركز الإشعارات</div>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              onClick={markSeen}
            >
              قراءة الكل
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2 py-2 dark:border-slate-800">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                  activeTab === t.key
                    ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="max-h-[55vh] overflow-auto">
            {isEmpty ? (
              <div className="p-6 text-center text-sm text-slate-500">لا توجد إشعارات.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {/* AppNotifications */}
                {visibleApp.map((n) => {
                  const style = appSeverityStyle[n.severity] ?? appSeverityStyle.NORMAL
                  const unread = !n.readAt
                  return (
                    <li
                      key={`app-${n.id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800",
                        unread && style.row,
                      )}
                      onClick={() => onOpenAppItem(n)}
                    >
                      <div className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", unread ? style.dot : "bg-transparent")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">{n.title}</span>
                          {n.count > 1 ? (
                            <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              تكرر {n.count} مرة
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">{n.message}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", style.badge)}>{style.label}</span>
                          <span className="text-[10px] text-slate-400">{CATEGORY_LABEL[n.category] ?? n.category}</span>
                          <span className="text-[10px] text-slate-400">·</span>
                          <span className="text-[10px] text-slate-400">{timeAgo(n.createdAt)}</span>
                          {unread ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); markOne.mutate(n.id) }}
                              className="mr-auto text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                              تعليم كمقروء
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}

                {/* Legacy fallback (only under "الكل") */}
                {showLegacy && legacy.map((n) => {
                  const Icon = iconMap[n.icon] ?? Bell
                  const style = severityStyles[n.severity]
                  return (
                    <li
                      key={`legacy-${n.id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800",
                        new Date(n.createdAt).getTime() > seenAt && style.row,
                      )}
                      onClick={() => {
                        if (n.link) {
                          openNotification(n.link)
                          setOpen(false)
                        }
                      }}
                    >
                      <div className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", style.dot)} />
                      <Icon className="h-4 w-4 flex-shrink-0 text-slate-500" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="truncate text-xs text-slate-600 dark:text-slate-400">{n.message}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function playNotificationTone() {
  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = "sine"
    oscillator.frequency.value = 880
    gain.gain.value = 0.05
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.18)
  } catch {
    // Browsers may block audio until the user interacts with the page.
  }
}
