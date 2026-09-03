import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Bell,
  FileText,
  Info,
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
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react"
import { api } from "../../api/client"
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

// New AppNotification center rows (batch 23C / 23C-B / 23E-23F).
type AppSeverity = "IMPORTANT" | "MEDIUM" | "NORMAL"
interface AppNotification {
  id: string
  type: string
  category: string
  severity: AppSeverity
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

const legacySeverityStyles: Record<Notification["severity"], { dot: string; row: string }> = {
  success: { dot: "bg-emerald-500", row: "bg-emerald-50/60 dark:bg-emerald-950/20" },
  warning: { dot: "bg-amber-500",   row: "bg-amber-50/60 dark:bg-amber-950/20" },
  error:   { dot: "bg-rose-500",    row: "bg-rose-50/60 dark:bg-rose-950/20" },
  info:    { dot: "bg-sky-500",     row: "bg-sky-50/60 dark:bg-sky-950/20" },
}

// The three severity buttons shown in the header.
const SEVERITY_BUTTONS: Array<{
  key: AppSeverity
  label: string
  icon: ComponentType<{ className?: string }>
  dot: string
  badge: string
  active: string
}> = [
  { key: "IMPORTANT", label: "مهم",   icon: AlertTriangle, dot: "bg-rose-500",  badge: "bg-rose-500",  active: "text-rose-600 dark:text-rose-400" },
  { key: "MEDIUM",    label: "متوسط", icon: Info,          dot: "bg-amber-500", badge: "bg-amber-500", active: "text-amber-600 dark:text-amber-400" },
  { key: "NORMAL",    label: "عادي",  icon: Bell,          dot: "bg-sky-500",   badge: "bg-sky-500",   active: "text-sky-600 dark:text-sky-400" },
]

const CATEGORY_LABEL: Record<string, string> = {
  IMPORTANT: "مهم",
  NEGATIVE_SALE: "بيع سالب / بخسارة",
  INVOICES: "فواتير",
  APPROVALS: "موافقات",
  STOCK: "مخزون",
  CUSTOMERS_DEBT: "زبائن وديون",
  WHATSAPP: "واتساب",
  SALES_AGENT: "المندوب",
  SYSTEM: "نظام",
}

// Category sub-filters shown inside an open severity panel.
const PANEL_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "ALL", label: "الكل" },
  { key: "NEGATIVE_SALE", label: "بيع سالب / بخسارة" },
  { key: "INVOICES", label: "فواتير" },
  { key: "APPROVALS", label: "موافقات" },
  { key: "STOCK", label: "مخزون" },
  { key: "CUSTOMERS_DEBT", label: "زبائن وديون" },
  { key: "WHATSAPP", label: "واتساب" },
  { key: "SALES_AGENT", label: "المندوب" },
  { key: "SYSTEM", label: "نظام" },
]

const SOUND_MUTED_KEY = "notifications_sound_muted"
const IMPORTANT_LAST_KEY = "notif_important_last"
const SOUND_LAST_PLAYED_KEY = "notif_sound_last_played"
const SOUND_COOLDOWN_MS = 10_000

async function fetchRecent(): Promise<Notification[]> {
  const { data } = await api.get<{ success: boolean; data: Notification[] }>("/notifications/recent", { params: { limit: 30 } })
  return data.data ?? []
}

async function fetchAppNotifications(): Promise<AppNotification[]> {
  const { data } = await api.get<{ success: boolean; items: AppNotification[] }>(
    "/notifications/app/recent",
    { params: { limit: 100 } },
  )
  return data.items ?? []
}

async function fetchAppCounts(): Promise<{ important: number; medium: number; normal: number }> {
  const { data } = await api.get<{ success: boolean; important: number; medium: number; normal: number }>(
    "/notifications/app/counts",
  )
  return { important: data.important ?? 0, medium: data.medium ?? 0, normal: data.normal ?? 0 }
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
  const [openSeverity, setOpenSeverity] = useState<AppSeverity | null>(null)
  const [catFilter, setCatFilter] = useState("ALL")
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem(SOUND_MUTED_KEY) === "true" } catch { return false }
  })
  const ref = useRef<HTMLDivElement | null>(null)
  const firstImportantLoad = useRef(true)

  function openNotification(path: string) {
    if (location.pathname === "/invoices/new") window.open(path, "_blank", "noopener,noreferrer")
    else navigate(path)
  }

  // Legacy derived feed (AuditLog / PendingApproval) — display-only fallback so
  // existing events don't disappear before every producer is migrated (23E).
  const { data: legacy = [] } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: fetchRecent,
    refetchInterval: 30_000,
  })

  // New AppNotification center feed (structured, server read/unread).
  const { data: appItems = [] } = useQuery({
    queryKey: ["app-notifications"],
    queryFn: fetchAppNotifications,
    refetchInterval: 30_000,
  })
  const { data: counts = { important: 0, medium: 0, normal: 0 } } = useQuery({
    queryKey: ["app-notification-counts"],
    queryFn: fetchAppCounts,
    refetchInterval: 30_000,
  })

  function invalidateApp() {
    queryClient.invalidateQueries({ queryKey: ["app-notifications"] })
    queryClient.invalidateQueries({ queryKey: ["app-notification-counts"] })
  }
  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/app/${id}/read`),
    onSuccess: invalidateApp,
  })
  const markAllSeverity = useMutation({
    mutationFn: (severity: AppSeverity) => api.post("/notifications/app/mark-all-read", { severity }),
    onSuccess: invalidateApp,
  })
  const archiveOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/app/${id}/archive`),
    onSuccess: invalidateApp,
  })

  // Close when clicking outside.
  useEffect(() => {
    if (!openSeverity) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenSeverity(null)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [openSeverity])

  // Legacy "unread" = anything newer than the last-seen timestamp (localStorage).
  const [seenAt, setSeenAt] = useState<number>(() => {
    try { return Number(localStorage.getItem("notif_seen_at") || 0) } catch { return 0 }
  })
  const legacyUnread = legacy.filter((n) => new Date(n.createdAt).getTime() > seenAt).length

  // Multi-tone sound for NEW IMPORTANT AppNotifications only (batch 23F).
  // NORMAL/MEDIUM and legacy are silent. Guarded by mute, a 10s cooldown, and a
  // first-load marker so old items never chime on page open.
  useEffect(() => {
    const important = appItems.filter((n) => n.severity === "IMPORTANT")
    if (!important.length) return
    const newest = important[0] // list is sorted newest-first by the API
    const newestTime = new Date(newest.createdAt).getTime()
    if (!Number.isFinite(newestTime)) return

    const lastSeen = Number(localStorage.getItem(IMPORTANT_LAST_KEY) || 0)
    if (firstImportantLoad.current) {
      firstImportantLoad.current = false
      localStorage.setItem(IMPORTANT_LAST_KEY, String(Math.max(lastSeen, newestTime)))
      return
    }
    if (newestTime <= lastSeen) return
    localStorage.setItem(IMPORTANT_LAST_KEY, String(newestTime))

    if (muted) return
    const lastPlayed = Number(localStorage.getItem(SOUND_LAST_PLAYED_KEY) || 0)
    if (Date.now() - lastPlayed < SOUND_COOLDOWN_MS) return
    localStorage.setItem(SOUND_LAST_PLAYED_KEY, String(Date.now()))
    playCategoryTone(newest.category)
  }, [appItems, muted])

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      try { localStorage.setItem(SOUND_MUTED_KEY, String(next)) } catch {}
      return next
    })
  }

  function toggleSeverity(sev: AppSeverity) {
    setOpenSeverity((cur) => {
      const next = cur === sev ? null : sev
      if (next) setCatFilter("ALL")
      return next
    })
  }

  function markSeenForPanel(sev: AppSeverity) {
    markAllSeverity.mutate(sev)
    // The NORMAL panel also carries the legacy feed → clear its local seen marker.
    if (sev === "NORMAL") {
      const now = Date.now()
      setSeenAt(now)
      try { localStorage.setItem("notif_seen_at", String(now)) } catch {}
    }
  }

  // The unread badge per button. NORMAL also includes legacy (shown in its panel).
  function badgeFor(sev: AppSeverity): number {
    if (sev === "IMPORTANT") return counts.important
    if (sev === "MEDIUM") return counts.medium
    return counts.normal + legacyUnread
  }

  // Items for the currently open panel (severity + category filter).
  const panelItems = useMemo(() => {
    if (!openSeverity) return []
    return appItems.filter(
      (n) => n.severity === openSeverity && (catFilter === "ALL" || n.category === catFilter),
    )
  }, [appItems, openSeverity, catFilter])

  const showLegacyInPanel = openSeverity === "NORMAL" && catFilter === "ALL"
  const panelEmpty = panelItems.length === 0 && (!showLegacyInPanel || legacy.length === 0)

  function onOpenAppItem(n: AppNotification) {
    if (!n.readAt) markOne.mutate(n.id)
    if (n.actionUrl) {
      openNotification(n.actionUrl)
      setOpenSeverity(null)
    }
  }

  const activeButton = SEVERITY_BUTTONS.find((b) => b.key === openSeverity)

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-0.5">
        {SEVERITY_BUTTONS.map((b) => {
          const Icon = b.icon
          const count = badgeFor(b.key)
          const isOpen = openSeverity === b.key
          return (
            <button
              key={b.key}
              type="button"
              aria-label={`إشعارات ${b.label}`}
              onClick={() => toggleSeverity(b.key)}
              className={cn(
                "relative flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition hover:bg-slate-100 dark:hover:bg-slate-800",
                isOpen ? b.active : "text-slate-500 dark:text-slate-400",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{b.label}</span>
              {count > 0 ? (
                <span className={cn("flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white", b.badge)}>
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {openSeverity && activeButton ? (
        <div className="absolute right-0 z-50 mt-2 max-h-[75vh] w-96 max-w-[92vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className={cn("h-2 w-2 rounded-full", activeButton.dot)} />
              مركز الإشعارات — {activeButton.label}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                onClick={toggleMute}
                title={muted ? "تشغيل الصوت" : "كتم الصوت"}
              >
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                {muted ? "تشغيل الصوت" : "كتم الصوت"}
              </button>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                onClick={() => markSeenForPanel(openSeverity)}
              >
                قراءة الكل
              </button>
            </div>
          </div>

          {/* Category sub-filters */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2 py-2 dark:border-slate-800">
            {PANEL_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCatFilter(c.key)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                  catFilter === c.key
                    ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="max-h-[55vh] overflow-auto">
            {panelEmpty ? (
              <div className="p-6 text-center text-sm text-slate-500">لا توجد إشعارات.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {panelItems.map((n) => {
                  const unread = !n.readAt
                  return (
                    <li
                      key={`app-${n.id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800",
                        unread && "bg-slate-50/70 dark:bg-slate-800/40",
                      )}
                      onClick={() => onOpenAppItem(n)}
                    >
                      <div className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", unread ? activeButton.dot : "bg-transparent")} />
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
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); archiveOne.mutate(n.id) }}
                            className={cn("text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200", unread ? "" : "mr-auto")}
                          >
                            أرشفة
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}

                {/* Legacy fallback (only in the "عادي" panel, "الكل" filter) */}
                {showLegacyInPanel && legacy.map((n) => {
                  const Icon = iconMap[n.icon] ?? Bell
                  const style = legacySeverityStyles[n.severity]
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
                          setOpenSeverity(null)
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

// WebAudio multi-tone player. A distinct short pattern per IMPORTANT category so
// the manager can tell a risky sale from an approval / WhatsApp / system alert
// without looking. No audio files. Browsers may block audio before interaction.
function playCategoryTone(category: string) {
  try {
    const ctx = new AudioContext()
    const beep = (freq: number, startAt: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.value = 0.05
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + startAt)
      osc.stop(ctx.currentTime + startAt + dur)
    }
    switch (category) {
      case "NEGATIVE_SALE": // two short descending warning beeps
        beep(660, 0, 0.15); beep(440, 0.2, 0.2); break
      case "APPROVALS": // two ascending
        beep(523, 0, 0.12); beep(784, 0.16, 0.15); break
      case "WHATSAPP": // double pulse, same pitch
        beep(600, 0, 0.1); beep(600, 0.15, 0.1); break
      case "SYSTEM": // single low tone
        beep(220, 0, 0.35); break
      default: // generic IMPORTANT
        beep(880, 0, 0.18)
    }
  } catch {
    // Browsers may block audio until the user interacts with the page.
  }
}
