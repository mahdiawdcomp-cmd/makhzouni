import { useEffect, useRef, useState, type ComponentType } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  Bell,
  FileText,
  Package,
  PackageMinus,
  Pencil,
  Receipt,
  ReceiptText,
  ShoppingCart,
  Trash2,
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

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  Receipt, ReceiptText, ShoppingCart, Wallet, Package, PackageMinus, Pencil, Trash2, FileText, UserPlus,
}

const severityStyles: Record<Notification["severity"], { dot: string; row: string }> = {
  success: { dot: "bg-emerald-500", row: "bg-emerald-50/60 dark:bg-emerald-950/20" },
  warning: { dot: "bg-amber-500",   row: "bg-amber-50/60 dark:bg-amber-950/20" },
  error:   { dot: "bg-rose-500",    row: "bg-rose-50/60 dark:bg-rose-950/20" },
  info:    { dot: "bg-sky-500",     row: "bg-sky-50/60 dark:bg-sky-950/20" },
}

async function fetchRecent(): Promise<Notification[]> {
  const { data } = await api.get<{ success: boolean; data: Notification[] }>("/notifications/recent", { params: { limit: 30 } })
  return data.data ?? []
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  const { data = [] } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: fetchRecent,
    refetchInterval: 30_000,
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

  // Treat anything newer than the last-seen timestamp as "unread".
  const [seenAt, setSeenAt] = useState<number>(() => {
    try { return Number(localStorage.getItem("notif_seen_at") || 0) } catch { return 0 }
  })
  const unreadCount = data.filter((n) => new Date(n.createdAt).getTime() > seenAt).length

  function markSeen() {
    const now = Date.now()
    setSeenAt(now)
    try { localStorage.setItem("notif_seen_at", String(now)) } catch {}
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        className="relative px-3"
        aria-label="الإشعارات"
        onClick={() => { setOpen((v) => !v); if (!open) markSeen() }}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute left-0 z-30 mt-2 max-h-[70vh] w-80 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-700">
            <div className="text-sm font-semibold">الإشعارات</div>
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              onClick={markSeen}
            >
              قراءة الكل
            </button>
          </div>

          {data.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">لا توجد إشعارات حالياً.</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((n) => {
                const Icon = iconMap[n.icon] ?? Bell
                const style = severityStyles[n.severity]
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800",
                      new Date(n.createdAt).getTime() > seenAt && style.row,
                    )}
                    onClick={() => {
                      if (n.link) {
                        navigate(n.link)
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
      ) : null}
    </div>
  )
}
