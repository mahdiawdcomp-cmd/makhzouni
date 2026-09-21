/**
 * «إشعارات المندوبين» — everything the reps do, for the owner.
 *
 * The counter here is ONE number from the server, counted over one table. It
 * is the same on the iPad, the desktop and the phone, because nothing about
 * "seen" lives in the browser: opening a row marks it read on the server.
 *
 * Filters exist so the owner can find the few things that need a decision in
 * a day's worth of visits and receipts — «يحتاج انتباهك» is the one to reach for.
 */
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Bell, CheckCheck, Loader2 } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { QueryErrorBox } from "../../components/ui/query-error"
import { toast } from "../../components/ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"
import { cn } from "../../utils/cn"
import { money } from "./format"

type ActivityItem = {
  id: string
  salesAgentId: string
  agentName: string
  kind: string
  customerId: string | null
  referenceId: string | null
  approvalId: string | null
  title: string
  message: string
  important: boolean
  amount: number | null
  read: boolean
  createdAt: string
}

type ActivityPage = {
  items: ActivityItem[]
  nextBefore: string | null
  unread: number
  importantUnread: number
}

/** The owner's words for each kind, and the order the chips appear in. */
const KINDS: Array<{ key: string; label: string }> = [
  { key: "EDIT_REQUEST", label: "تنتظر موافقتك" },
  { key: "INVOICE_EDIT", label: "تعديل فاتورة" },
  { key: "INVOICE_CANCEL", label: "إلغاء فاتورة" },
  { key: "ORDER", label: "طلبات" },
  { key: "RECEIPT", label: "سندات" },
  { key: "VISIT", label: "زيارات" },
  { key: "ISSUE", label: "مشاكل" },
  { key: "NEW_CUSTOMER", label: "زبائن جدد" },
  { key: "PRICE_REQUEST", label: "طلبات أسعار" },
  { key: "AREA_PROPOSAL", label: "مناطق مقترحة" },
]

/** Kinds whose row points at something still sitting in the approvals screen. */
const AWAITS_OWNER = new Set(["EDIT_REQUEST", "AREA_PROPOSAL", "ORDER", "PRICE_REQUEST"])

function ago(value: string): string {
  const ms = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  const min = Math.floor(ms / 60_000)
  if (min < 1) return "هسه"
  if (min < 60) return `قبل ${min} دقيقة`
  const h = Math.floor(min / 60)
  if (h < 24) return `قبل ${h} ساعة`
  const d = Math.floor(h / 24)
  return d === 1 ? "أمس" : `قبل ${d} يوم`
}

export function AgentActivityPanel({ agents }: { agents: Array<{ id: string; name: string }> }) {
  const qc = useQueryClient()
  const [agentId, setAgentId] = useState("")
  const [kind, setKind] = useState("")
  const [importantOnly, setImportantOnly] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const params = useMemo(
    () => ({
      ...(agentId ? { agentId } : {}),
      ...(kind ? { kind } : {}),
      ...(importantOnly ? { important: "1" } : {}),
      ...(unreadOnly ? { unread: "1" } : {}),
    }),
    [agentId, kind, importantOnly, unreadOnly],
  )

  const feed = useInfiniteQuery({
    queryKey: ["sales-agent-admin", "activity", params],
    initialPageParam: "" as string,
    queryFn: async ({ pageParam }): Promise<ActivityPage> => {
      const res = await api.get<{ data: Partial<ActivityPage> | null }>("/sales-agent-admin/activity", {
        params: { ...params, limit: 40, ...(pageParam ? { before: pageParam } : {}) },
      })
      // Normalized, never trusted: an unexpected shape (an older backend, a
      // proxy error page) must empty THIS panel, not throw inside render and
      // take the owner's whole rep page down with it.
      const d = res.data?.data
      return {
        items: Array.isArray(d?.items) ? d!.items : [],
        nextBefore: typeof d?.nextBefore === "string" ? d.nextBefore : null,
        unread: Number(d?.unread) || 0,
        importantUnread: Number(d?.importantUnread) || 0,
      }
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    // Realtime covers most writes; this catches the few that publish nothing
    // (a visit), without the owner having to reload.
    refetchInterval: 60_000,
    retry: 3,
  })

  const items = feed.data?.pages.flatMap((p) => p.items) ?? []
  // The counts come with every page and the FIRST page is the freshest.
  const unread = feed.data?.pages[0]?.unread ?? 0
  const importantUnread = feed.data?.pages[0]?.importantUnread ?? 0

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "activity"] })
    void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "activity-counts"] })
  }

  const markRead = useMutation({
    mutationFn: async (body: { ids?: string[]; filter?: Record<string, string> }) =>
      (await api.post("/sales-agent-admin/activity/read", body)).data,
    onSuccess: refresh,
    onError: (err) => toast({ title: "ما انعلّمت", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const chip = (active: boolean) =>
    cn(
      "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors",
      active
        ? "border-[var(--theme-accent)] bg-[var(--theme-accent)] text-white"
        : "border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)] text-slate-600 hover:border-[var(--theme-accent)] dark:text-slate-300",
    )

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2">
          <Bell className="size-5 text-[var(--theme-accent)]" aria-hidden="true" />
          <CardTitle>إشعارات المندوبين</CardTitle>
          {unread > 0 && (
            <span className="rounded-full bg-[var(--theme-accent)] px-2 py-0.5 text-xs font-bold text-white tabular-nums">
              {unread}
            </span>
          )}
          {importantUnread > 0 && (
            <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
              {importantUnread} مهم
            </span>
          )}
        </div>
        <Button
          variant="outline"
          className="h-11"
          disabled={unread === 0 || markRead.isPending}
          // Marks only what matches the filters in view: «علّم الكل» on a
          // filtered list must not clear rows the owner never looked at.
          onClick={() => markRead.mutate({ filter: params })}
        >
          {markRead.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
          علّم المعروض مقروء
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            aria-label="المندوب"
            className="h-11 min-w-[10rem] cursor-pointer rounded-xl border border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)] px-3 text-[13.5px]"
          >
            <option value="">كل المندوبين</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button type="button" aria-pressed={importantOnly} onClick={() => setImportantOnly((v) => !v)} className={chip(importantOnly)}>
            يحتاج انتباهك
            {importantUnread > 0 && <span className={cn("text-xs tabular-nums", importantOnly ? "text-white/80" : "text-rose-500")}>{importantUnread}</span>}
          </button>
          <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} className={chip(unreadOnly)}>
            غير المقروءة بس
          </button>
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="نوع الحركة">
          <button type="button" aria-pressed={!kind} onClick={() => setKind("")} className={chip(!kind)}>الكل</button>
          {KINDS.map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(kind === k.key ? "" : k.key)} className={chip(kind === k.key)}>
              {k.label}
            </button>
          ))}
        </div>

        {feed.error ? (
          <QueryErrorBox title="ما وصلت الإشعارات" onRetry={() => void feed.refetch()} />
        ) : feed.isPending ? (
          <p className="py-8 text-center text-sm text-slate-500">جاري التحميل…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">ماكو شي هنا</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => { if (!item.read) markRead.mutate({ ids: [item.id] }) }}
                  className={cn(
                    "w-full rounded-xl border p-3 text-start transition-colors",
                    item.read
                      ? "border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)]"
                      : item.important
                        ? "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
                        : "border-[var(--theme-accent)] bg-[var(--theme-accentSoft)]",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {!item.read && <span className="size-2 shrink-0 rounded-full bg-[var(--theme-accent)]" aria-label="جديد" />}
                    <span className="font-semibold">{item.title}</span>
                    <span className="text-[12px] text-slate-500">{item.agentName}</span>
                    <span className="ms-auto text-[12px] tabular-nums text-slate-500">{ago(item.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                    {item.message}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {item.amount != null && <span className="text-[13px] font-bold tabular-nums">{money(item.amount)}</span>}
                    {item.approvalId && AWAITS_OWNER.has(item.kind) && (
                      <Link
                        to="/approvals"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-lg bg-[var(--theme-accent)] px-3 py-1.5 text-[12px] font-semibold text-white"
                      >
                        افتح الموافقات
                      </Link>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {feed.hasNextPage && (
          <Button variant="outline" className="h-11 w-full" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {feed.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
            عرض الأقدم
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
