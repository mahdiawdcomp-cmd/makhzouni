/**
 * «خطة زيارات المندوب» — the owner's side of the day's round.
 *
 * The rep builds their own plan from their own screen; this is where the owner
 * assigns one. Both write the same rows through the same service, so there is
 * one plan per rep per day and no second notion of "planned".
 *
 * Two rules the screen makes visible rather than merely obeying:
 *
 *  - Only the CHOSEN rep's customers can be offered, because the endpoint it
 *    reads is scoped to that rep. Moving a customer to another rep is still a
 *    customer edit, done the old way on the customers screen — never a
 *    side effect of planning a visit.
 *  - Cancelling a plan entry cancels the INTENTION. A visit that actually
 *    happened keeps its own row, its outcome and the order it produced; the
 *    screen keeps showing them next to the cancelled entry.
 *
 * Ordering is done with «فوق»/«جوه» buttons, not drag-and-drop: this is used
 * one-handed on a phone, where dragging a row inside a scrolling list is a
 * fight rather than a feature.
 */
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { QueryErrorBox } from "../../components/ui/query-error"
import { toast } from "../../components/ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"
import { cn } from "../../utils/cn"
import { AgentDialog, AgentField, AgentLoading, AgentStatusPill } from "./shared"
import { money } from "./format"
import type { VisitPlanEntry } from "./types"

type AgentOption = { agentId: string; name: string; isActive: boolean }

type AgentCustomer = {
  id: string
  name: string
  phone: string
  area: string | null
  address: string | null
  currentBalance: number
  hasLocation: boolean
}

/** Today in the BROWSER's calendar, only as the date input's starting value. */
function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

const STATUS_TONE: Record<string, "ok" | "wait" | "bad" | "muted"> = {
  PLANNED: "muted",
  STARTED: "wait",
  DONE: "ok",
  CANCELLED: "bad",
}

export function AdminVisitPlanPanel({ agents }: { agents: AgentOption[] }) {
  const qc = useQueryClient()
  const [agentId, setAgentId] = useState("")
  const [planDate, setPlanDate] = useState(todayKey())
  const [search, setSearch] = useState("")
  const [area, setArea] = useState("")
  const [adding, setAdding] = useState(false)
  const [noteFor, setNoteFor] = useState<VisitPlanEntry | null>(null)
  const [noteDraft, setNoteDraft] = useState("")

  const plan = useQuery({
    queryKey: ["sales-agent-admin", "visit-plan", agentId, planDate],
    enabled: Boolean(agentId && planDate),
    queryFn: async () => {
      const res = await api.get<{ data: { date: string; entries: VisitPlanEntry[] } }>(
        "/sales-agent-admin/visit-plan",
        { params: { salesAgentId: agentId, date: planDate } },
      )
      return res.data.data
    },
    retry: 3,
  })

  const customers = useQuery({
    queryKey: ["sales-agent-admin", "agent-customers", agentId, search, area],
    enabled: Boolean(agentId) && adding,
    queryFn: async () => {
      const res = await api.get<{ data: AgentCustomer[] }>("/sales-agent-admin/agent-customers", {
        params: {
          salesAgentId: agentId,
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(area ? { area } : {}),
          limit: 100,
        },
      })
      return res.data.data ?? []
    },
    retry: 3,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "visit-plan"] })
    void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "agent-customers"] })
  }

  const entries = useMemo(() => plan.data?.entries ?? [], [plan.data])
  const plannedIds = useMemo(() => new Set(entries.map((e) => e.customerId)), [entries])
  // The areas the chosen rep actually works, taken from their own customers —
  // no extra endpoint, and never an area that belongs to nobody.
  const areas = useMemo(() => {
    const found = new Set<string>()
    for (const c of customers.data ?? []) if (c.area) found.add(c.area)
    for (const e of entries) if (e.area) found.add(e.area)
    return [...found].sort()
  }, [customers.data, entries])

  const add = useMutation({
    mutationFn: async (customerId: string) => {
      const res = await api.post("/sales-agent-admin/visit-plan", {
        salesAgentId: agentId,
        customerId,
        planDate,
        sortOrder: entries.length + 1,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انضاف لخطة المندوب" })
      refresh()
    },
    onError: (err) => {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code
      toast({
        title:
          code === "VISIT_PLAN_DUPLICATE"
            ? "هذا الزبون موجود بخطة نفس اليوم"
            : code === "CUSTOMER_NOT_IN_SCOPE"
              ? "هذا الزبون تابع لمندوب ثاني — غيّر تبعيته من صفحة الزبائن أولاً"
              : "تعذر الإضافة للخطة",
        description: apiErrorMessage(err),
        variant: "destructive",
      })
    },
  })

  const update = useMutation({
    mutationFn: async (payload: { id: string; status?: string; note?: string; sortOrder?: number }) => {
      const { id, ...body } = payload
      const res = await api.patch(`/sales-agent-admin/visit-plan/${id}`, body)
      return res.data
    },
    onSuccess: () => refresh(),
    onError: (err) =>
      toast({ title: "تعذر تحديث الخطة", description: apiErrorMessage(err), variant: "destructive" }),
  })

  /**
   * Swap two neighbours' positions.
   *
   * ONE mutation that writes both rows in sequence, then refreshes once.
   * Firing two independent mutations raced: each completed with its own
   * refetch, so the list could redraw from a half-applied swap and the move
   * appeared not to happen.
   */
  const move = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: -1 | 1 }) => {
      const current = entries[index]
      const neighbour = entries[index + direction]
      if (!current || !neighbour) return
      const currentPos = current.sortOrder ?? index + 1
      const neighbourPos = neighbour.sortOrder ?? index + direction + 1
      await api.patch(`/sales-agent-admin/visit-plan/${current.id}`, { sortOrder: neighbourPos })
      await api.patch(`/sales-agent-admin/visit-plan/${neighbour.id}`, { sortOrder: currentPos })
    },
    onSuccess: () => refresh(),
    onError: (err) =>
      toast({ title: "تعذر تغيير الترتيب", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const activeAgents = agents.filter((a) => a.isActive || plannedIds.size > 0)

  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle>خطة زيارات المندوب</CardTitle>
        {agentId && (
          <Button className="h-11" onClick={() => setAdding(true)}>
            أضف زبائن للخطة
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-slate-500">
          الخطة هي نيّة الزيارة؛ الزيارة الفعلية تبقى مسجّلة بنتيجتها وبطلبها المرتبط. إلغاء الخطة لا يحذف زيارة صارت
          فعلاً. التاريخ واليوم بتوقيت المحل.
        </p>

        {/* اختيار المندوب واليوم */}
        <div className="space-y-3">
          <AgentField label="المندوب">
            <div className="flex flex-wrap gap-2">
              {activeAgents.length === 0 ? (
                <span className="text-sm text-slate-500">ما اكو مندوبين.</span>
              ) : (
                activeAgents.map((agent) => (
                  <Button
                    key={agent.agentId}
                    className="h-11"
                    variant={agentId === agent.agentId ? "default" : "outline"}
                    onClick={() => {
                      setAgentId(agent.agentId)
                      setAdding(false)
                    }}
                  >
                    {agent.name}
                    {!agent.isActive && " (معطّل)"}
                  </Button>
                ))
              )}
            </div>
          </AgentField>

          <div className="grid gap-3 sm:grid-cols-2">
            <AgentField label="تاريخ الخطة">
              <Input
                className="h-11"
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
              />
            </AgentField>
            {areas.length > 0 && (
              <AgentField label="المنطقة (للبحث عن زبائن)">
                <div className="flex flex-wrap gap-2">
                  {[["", "كل المناطق"], ...areas.map((a) => [a, a] as const)].map(([value, label]) => (
                    <Button
                      key={String(value)}
                      className="h-11"
                      variant={area === value ? "default" : "outline"}
                      onClick={() => setArea(String(value))}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </AgentField>
            )}
          </div>
        </div>

        {/* الخطة نفسها */}
        {!agentId ? (
          <p className="py-8 text-center text-sm text-slate-500">اختر مندوباً لعرض خطته.</p>
        ) : plan.isLoading ? (
          <AgentLoading label="جاري قراءة الخطة…" />
        ) : plan.isError ? (
          <QueryErrorBox title="ما وصلت خطة المندوب" onRetry={() => void plan.refetch()} />
        ) : entries.length === 0 ? (
          <div className="rounded-lg border p-6 text-center" style={{ borderColor: "var(--theme-cardBorder)" }}>
            <p className="text-sm text-slate-600 dark:text-slate-300">ماكو خطة لهذا اليوم.</p>
            <Button className="mt-3 h-11" onClick={() => setAdding(true)}>
              أضف زبائن للخطة
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry, index) => (
              <li
                key={entry.id}
                className={cn("rounded-lg border p-3", entry.status === "CANCELLED" && "opacity-60")}
                style={{ borderColor: "var(--theme-cardBorder)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {index + 1}. {entry.customerName}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {[entry.area, entry.address].filter(Boolean).join(" · ") || "بلا عنوان"}
                      {entry.currentBalance > 0 ? ` · عليه ${money(entry.currentBalance)}` : ""}
                    </p>
                    {entry.note && <p className="mt-1 text-[12px] text-slate-500">ملاحظة: {entry.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <AgentStatusPill tone={STATUS_TONE[entry.status] ?? "muted"}>
                      {entry.statusLabel}
                    </AgentStatusPill>
                    {entry.visit?.orderLinked && <AgentStatusPill tone="ok">أنتجت طلباً</AgentStatusPill>}
                    {entry.visit?.manualOutcome && (
                      <AgentStatusPill tone="wait">نتيجة يدوية بدون طلب</AgentStatusPill>
                    )}
                  </div>
                </div>

                {entry.visit && (
                  <p className="mt-2 rounded bg-slate-50 p-2 text-[12px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    الزيارة الفعلية: {entry.visit.endedAt ? (entry.visit.outcomeLabel ?? "منتهية") : "مفتوحة الآن"}
                    {entry.visit.note ? ` · ${entry.visit.note}` : ""}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="h-11"
                    variant="outline"
                    disabled={index === 0 || move.isPending}
                    onClick={() => move.mutate({ index, direction: -1 })}
                  >
                    فوق
                  </Button>
                  <Button
                    className="h-11"
                    variant="outline"
                    disabled={index === entries.length - 1 || move.isPending}
                    onClick={() => move.mutate({ index, direction: 1 })}
                  >
                    جوه
                  </Button>
                  <Button
                    className="h-11"
                    variant="outline"
                    onClick={() => {
                      setNoteFor(entry)
                      setNoteDraft(entry.note ?? "")
                    }}
                  >
                    الملاحظة
                  </Button>
                  {entry.status === "CANCELLED" ? (
                    <Button
                      className="h-11"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: entry.id, status: "PLANNED" })}
                    >
                      إرجاع للخطة
                    </Button>
                  ) : (
                    <Button
                      className="h-11"
                      variant="outline"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: entry.id, status: "CANCELLED" })}
                    >
                      إلغاء الزيارة المخططة
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {/* إضافة زبائن */}
      {adding && agentId && (
        <AgentDialog title="أضف زبائن لخطة اليوم" onClose={() => setAdding(false)}>
          <Input
            className="h-11"
            placeholder="ابحث باسم الزبون أو رقمه"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="mt-2 text-[12px] text-slate-500">
            تظهر زبائن هذا المندوب فقط. زبون مندوب ثاني ما يظهر هنا — تبعية الزبون تتغير من صفحة الزبائن.
          </p>

          <div className="mt-3">
            {customers.isLoading ? (
              <AgentLoading label="جاري قراءة زبائنه…" />
            ) : customers.isError ? (
              <QueryErrorBox title="ما وصلت قائمة زبائنه" onRetry={() => void customers.refetch()} />
            ) : (customers.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">ماكو زبائن مطابقين لهذا البحث.</p>
            ) : (
              <ul className="space-y-2">
                {(customers.data ?? []).map((customer) => {
                  const already = plannedIds.has(customer.id)
                  return (
                    <li
                      key={customer.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                      style={{ borderColor: "var(--theme-cardBorder)" }}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{customer.name}</p>
                        <p className="text-[12px] text-slate-500" dir="ltr">
                          {customer.phone}
                        </p>
                        <p className="text-[12px] text-slate-500">
                          {[customer.area, customer.hasLocation ? "عنده موقع" : "بلا موقع"]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Button
                        className="h-11"
                        variant={already ? "outline" : "default"}
                        disabled={already || add.isPending}
                        onClick={() => add.mutate(customer.id)}
                      >
                        {already ? "موجود بالخطة" : "أضف"}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </AgentDialog>
      )}

      {/* الملاحظة */}
      {noteFor && (
        <AgentDialog
          title="ملاحظة الزيارة المخططة"
          onClose={() => setNoteFor(null)}
          footer={
            <Button
              className="h-12 w-full"
              disabled={update.isPending}
              onClick={() => {
                update.mutate({ id: noteFor.id, note: noteDraft })
                setNoteFor(null)
              }}
            >
              حفظ الملاحظة
            </Button>
          }
        >
          <p className="font-semibold">{noteFor.customerName}</p>
          <div className="mt-3">
            <AgentField label="الملاحظة">
              <Input className="h-11" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
            </AgentField>
          </div>
        </AgentDialog>
      )}
    </Card>
  )
}
