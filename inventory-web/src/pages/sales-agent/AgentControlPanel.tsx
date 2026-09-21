/**
 * «متابعة المندوب» — the owner's read of a rep's day, and of every rep at once.
 *
 * Three views, because they answer three different questions:
 *   - «يومه»: what did this rep file today, when, and where from
 *   - «مقارنة»: who is producing, over a window
 *   - «المناطق»: which neighbourhoods are alive and which are dead
 *
 * Every number here is derived from work the rep already files. The map shows
 * the places they filed FROM — not a route, because no route is recorded.
 *
 * The wording is load-bearing. A hole in the timeline is «ما سجّل شي», never
 * «ما اشتغل»: a rep driving between districts or sitting with a shopkeeper who
 * talks files nothing for an hour and is working the whole time. A screen that
 * says otherwise turns an honest gap into an accusation.
 */
import { Suspense, lazy, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, MapPin, Users } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table"
import { QueryErrorBox } from "../../components/ui/query-error"
import { cn } from "../../utils/cn"
import { money } from "./format"
import { AgentStatusPill as StatusPill } from "./shared"
import { formatDistance } from "../../utils/agentLocation"

const VisitMap = lazy(() => import("./VisitMap"))

type DayEvent = {
  at: string
  action: "ORDER" | "RECEIPT" | "VISIT" | "NEW_CUSTOMER" | "ISSUE"
  customerId: string | null
  customerName: string | null
  amount: number | null
  detail: string | null
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  distanceM: number | null
  locationStatus: string | null
  sendLagMin: number | null
}

type AgentDay = {
  date: string
  agentName: string
  events: DayEvent[]
  startedAt: string | null
  endedAt: string | null
  spanMin: number
  gaps: Array<{ fromAt: string; toAt: string; minutes: number }>
  idleMin: number
  counts: {
    orders: number
    rejectedOrders: number
    receipts: number
    visits: number
    issues: number
    newCustomers: number
    customersVisited: number
  }
  money: { sold: number; collected: number; rejectedValue: number }
  location: { withFix: number; denied: number; unavailable: number; far: number; vague: number }
  areas: Array<{ area: string; actions: number }>
}

type AgentSummary = {
  agentId: string
  agentName: string
  daysWorked: number
  orders: number
  rejectedOrders: number
  receipts: number
  visits: number
  issues: number
  newCustomers: number
  sold: number
  collected: number
  farActions: number
  deniedLocations: number
}

type AreaRow = { area: string; customers: number; orders: number; sold: number; collected: number }

const ACTION_LABEL: Record<DayEvent["action"], string> = {
  ORDER: "طلب",
  RECEIPT: "سند",
  VISIT: "زيارة",
  NEW_CUSTOMER: "زبون جديد",
  ISSUE: "مشكلة",
}

/** Shop-local clock time. The server already did the timezone work. */
function clock(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit", hour12: true })
}

/** «3 ساعات و20 دقيقة» — a duration an owner reads without doing arithmetic. */
function duration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} دقيقة`
  if (m === 0) return `${h} ساعة`
  return `${h} ساعة و${m} دقيقة`
}

function todayKey(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function daysAgoKey(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function Tile({
  title,
  value,
  sub,
  tone = "plain",
}: {
  title: string
  value: string
  sub?: string
  tone?: "plain" | "warn" | "bad"
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "bad"
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
          : tone === "warn"
            ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)]",
      )}
    >
      <p className="text-[12px] text-slate-500">{title}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  )
}

/**
 * How an action's position reads on the row.
 *
 * A vague fix NEVER reads as «بعيد». The two are separate findings and merging
 * them is how an owner ends up confronting a rep over a weak signal indoors.
 */
function locationCell(e: DayEvent): { label: string; tone: "ok" | "wait" | "bad" | "muted" } {
  if (e.locationStatus == null) return { label: "—", tone: "muted" }
  if (e.locationStatus === "DENIED") return { label: "رفض الموقع", tone: "wait" }
  if (e.locationStatus !== "OK") return { label: "ما وصل", tone: "wait" }
  if (e.accuracyM != null && e.accuracyM > 200) return { label: "تقريبي", tone: "wait" }
  if (e.distanceM == null) return { label: "المحل بلا موقع", tone: "muted" }
  if (e.distanceM > 500) return { label: formatDistance(e.distanceM), tone: "bad" }
  return { label: formatDistance(e.distanceM), tone: "ok" }
}

export function AgentControlPanel({ agents }: { agents: Array<{ id: string; name: string }> }) {
  const [tab, setTab] = useState<"day" | "compare" | "areas">("day")
  const [agentId, setAgentId] = useState("")
  const [date, setDate] = useState(todayKey())
  const [from, setFrom] = useState(daysAgoKey(29))
  const [to, setTo] = useState(todayKey())

  // The first rep, so the panel opens on something rather than on a prompt.
  const picked = agentId || agents[0]?.id || ""

  const day = useQuery({
    queryKey: ["sales-agent-admin", "agent-day", picked, date],
    enabled: tab === "day" && Boolean(picked),
    queryFn: async () => {
      const res = await api.get<{ data: AgentDay }>("/sales-agent-admin/agent-day", {
        params: { salesAgentId: picked, date },
      })
      return res.data.data
    },
    retry: 3,
  })

  const overview = useQuery({
    queryKey: ["sales-agent-admin", "agents-overview", from, to],
    enabled: tab === "compare",
    queryFn: async () => {
      const res = await api.get<{ data: { agents: AgentSummary[] } }>(
        "/sales-agent-admin/agents-overview",
        { params: { from, to } },
      )
      return res.data.data.agents ?? []
    },
    retry: 3,
  })

  const areas = useQuery({
    queryKey: ["sales-agent-admin", "area-performance", from, to],
    enabled: tab === "areas",
    queryFn: async () => {
      const res = await api.get<{ data: { areas: AreaRow[] } }>(
        "/sales-agent-admin/area-performance",
        { params: { from, to } },
      )
      return res.data.data.areas ?? []
    },
    retry: 3,
  })

  const pins = useMemo(() => {
    const events = day.data?.events ?? []
    return events
      .filter((e) => e.latitude != null && e.longitude != null)
      .map((e, index) => ({
        id: `${index}`,
        // Numbered so the map and the table below read as one list.
        name: `${index + 1}. ${ACTION_LABEL[e.action]} · ${e.customerName ?? "بدون زبون"}`,
        latitude: e.latitude as number,
        longitude: e.longitude as number,
        // Green = at the shop, amber = too far to be at it. The map's own
        // vocabulary; nothing here is "visited".
        visited: e.distanceM != null && e.distanceM <= 500,
        planned: e.distanceM == null || e.distanceM > 500,
        distanceKm: e.distanceM == null ? null : Number((e.distanceM / 1000).toFixed(2)),
      }))
  }, [day.data])

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>متابعة المندوب</CardTitle>
          <p className="mt-0.5 text-[12px] text-slate-500">
            من الحركات الي يسجّلها المندوب نفسه. ما اكو تتبع للطريق — الخريطة تبيّن أماكن التسجيل فقط.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="نوع التقرير">
          {(
            [
              ["day", "يومه"],
              ["compare", "مقارنة المندوبين"],
              ["areas", "المناطق"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              className="h-11"
              variant={tab === key ? "default" : "outline"}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        {tab === "day" ? (
          <>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select
                value={picked}
                onChange={(e) => setAgentId(e.target.value)}
                aria-label="المندوب"
                className="h-11 w-full cursor-pointer rounded border border-slate-300 bg-white px-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="التاريخ"
                className="h-11"
              />
            </div>

            {day.error ? (
              <QueryErrorBox title="ما وصل تقرير اليوم" onRetry={() => void day.refetch()} />
            ) : day.isPending ? (
              <p className="py-8 text-center text-sm text-slate-500">جاري التحميل…</p>
            ) : (day.data?.events.length ?? 0) === 0 ? (
              <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                ما سجّل ولا حركة بهذا اليوم.
              </p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  <Tile title="بدأ" value={clock(day.data!.startedAt)} sub={`خلص ${clock(day.data!.endedAt)}`} />
                  <Tile
                    title="مدة الدوام"
                    value={duration(day.data!.spanMin)}
                    sub={`من أول حركة لآخر وحدة`}
                  />
                  <Tile
                    title="فجوات بلا تسجيل"
                    value={day.data!.gaps.length === 0 ? "ماكو" : duration(day.data!.idleMin)}
                    sub={day.data!.gaps.length > 0 ? `${day.data!.gaps.length} فجوة` : undefined}
                    tone={day.data!.gaps.length > 0 ? "warn" : "plain"}
                  />
                  <Tile
                    title="زبائن زارهم"
                    value={String(day.data!.counts.customersVisited)}
                    sub={`${day.data!.events.length} حركة`}
                  />
                  <Tile title="باع" value={money(day.data!.money.sold)} sub={`${day.data!.counts.orders} طلب`} />
                  <Tile
                    title="قبض"
                    value={money(day.data!.money.collected)}
                    sub={`${day.data!.counts.receipts} سند`}
                  />
                  <Tile
                    title="مرفوض"
                    value={String(day.data!.counts.rejectedOrders)}
                    sub={day.data!.counts.rejectedOrders > 0 ? money(day.data!.money.rejectedValue) : undefined}
                    tone={day.data!.counts.rejectedOrders > 0 ? "warn" : "plain"}
                  />
                  <Tile
                    title="بعيد عن المحل"
                    value={String(day.data!.location.far)}
                    sub={
                      day.data!.location.denied > 0
                        ? `${day.data!.location.denied} رفض الموقع`
                        : day.data!.location.withFix === 0
                          ? "ما اكو مواقع بعد"
                          : undefined
                    }
                    tone={day.data!.location.far > 0 ? "bad" : "plain"}
                  />
                </div>

                {/* Stated plainly, because the number above invites the wrong
                    conclusion on its own. */}
                {day.data!.gaps.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="size-4" /> فجوات ما سجّل بيها شي
                    </p>
                    <ul className="mt-1.5 space-y-0.5">
                      {day.data!.gaps.map((g, i) => (
                        <li key={i} className="tabular-nums">
                          {clock(g.fromAt)} ← {clock(g.toAt)} · {duration(g.minutes)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[12px]">
                      الفجوة تعني ما سجّل حركة، مو بالضرورة ما اشتغل — السواقة بين المناطق والجلسة
                      الطويلة بمحل ما ينسجلون.
                    </p>
                  </div>
                )}

                {pins.length > 0 && (
                  <Suspense fallback={<div className="grid h-40 place-items-center text-sm text-slate-500">جاري فتح الخريطة…</div>}>
                    <VisitMap pins={pins} onPick={() => {}} />
                  </Suspense>
                )}

                <Table>
                  <THead>
                    <TR>
                      <TH>الوقت</TH>
                      <TH>الحركة</TH>
                      <TH>الزبون</TH>
                      <TH>المبلغ</TH>
                      <TH>الموقع</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {day.data!.events.map((e, i) => {
                      const loc = locationCell(e)
                      return (
                        <TR key={`${e.at}:${i}`}>
                          <TD className="tabular-nums">{clock(e.at)}</TD>
                          <TD>
                            {ACTION_LABEL[e.action]}
                            {e.detail && (
                              <span className="ms-1 text-[12px] text-slate-500">{e.detail}</span>
                            )}
                          </TD>
                          <TD>{e.customerName ?? "—"}</TD>
                          <TD className="tabular-nums">{e.amount ? money(e.amount) : "—"}</TD>
                          <TD>
                            <StatusPill tone={loc.tone}>{loc.label}</StatusPill>
                            {/* A long lag is the offline case, and saying so
                                stops it reading as a rep who wandered. */}
                            {e.sendLagMin != null && e.sendLagMin >= 20 && (
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                انرسل بعد {duration(e.sendLagMin)} من التسجيل
                              </p>
                            )}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>

                {day.data!.areas.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MapPin className="size-4 text-slate-400" aria-hidden="true" />
                    {day.data!.areas.map((a) => (
                      <StatusPill key={a.area} tone="muted">
                        {a.area} · {a.actions}
                      </StatusPill>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] text-slate-500">من</span>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] text-slate-500">إلى</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
              </label>
            </div>

            {tab === "compare" ? (
              overview.error ? (
                <QueryErrorBox title="ما وصلت المقارنة" onRetry={() => void overview.refetch()} />
              ) : overview.isPending ? (
                <p className="py-8 text-center text-sm text-slate-500">جاري التحميل…</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>المندوب</TH>
                      <TH>أيام اشتغل</TH>
                      <TH>باع</TH>
                      <TH>قبض</TH>
                      <TH>طلبات</TH>
                      <TH>زبائن جدد</TH>
                      <TH>بعيد</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(overview.data ?? []).map((a) => (
                      <TR key={a.agentId}>
                        <TD className="font-medium">{a.agentName}</TD>
                        <TD className="tabular-nums">{a.daysWorked}</TD>
                        <TD className="font-medium tabular-nums">{money(a.sold)}</TD>
                        <TD className="tabular-nums">{money(a.collected)}</TD>
                        <TD className="tabular-nums">
                          {a.orders}
                          {a.rejectedOrders > 0 && (
                            <span className="ms-1 text-[12px] text-red-600">({a.rejectedOrders} مرفوض)</span>
                          )}
                        </TD>
                        <TD className="tabular-nums">{a.newCustomers}</TD>
                        <TD className="tabular-nums">
                          {a.farActions > 0 ? (
                            <StatusPill tone="bad">{a.farActions}</StatusPill>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                          {a.deniedLocations > 0 && (
                            <span className="ms-1 text-[11px] text-amber-700">
                              {a.deniedLocations} رفض
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )
            ) : areas.error ? (
              <QueryErrorBox title="ما وصلت المناطق" onRetry={() => void areas.refetch()} />
            ) : areas.isPending ? (
              <p className="py-8 text-center text-sm text-slate-500">جاري التحميل…</p>
            ) : (areas.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">ما اكو زبائن مربوطين بمناطق بعد</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>المنطقة</TH>
                    <TH>زبائن</TH>
                    <TH>طلبات</TH>
                    <TH>باع</TH>
                    <TH>قبض</TH>
                  </TR>
                </THead>
                <TBody>
                  {(areas.data ?? []).map((a) => (
                    <TR key={a.area} className={a.orders === 0 ? "opacity-70" : ""}>
                      <TD className="font-medium">
                        <span className="flex items-center gap-1.5">
                          <Users className="size-3.5 text-slate-400" aria-hidden="true" />
                          {a.area}
                        </span>
                      </TD>
                      <TD className="tabular-nums">{a.customers}</TD>
                      <TD className="tabular-nums">
                        {a.orders === 0 ? <StatusPill tone="wait">ماكو</StatusPill> : a.orders}
                      </TD>
                      <TD className="font-medium tabular-nums">{money(a.sold)}</TD>
                      <TD className="tabular-nums">{money(a.collected)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
