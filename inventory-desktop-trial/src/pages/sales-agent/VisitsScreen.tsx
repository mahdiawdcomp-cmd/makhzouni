/**
 * «زياراتي» — today's plan, then the round, then the map.
 *
 * The screen is built around the distinction the data makes: a PLAN is what the
 * rep is meant to do today (assigned by the owner, or added by the rep from
 * their own customers), and a VISIT is what actually happened. So the plan comes
 * first, split into what is still to do and what is finished, and the customers
 * who are not on the plan sit in their own section below.
 *
 * Location rules, visible in the code on purpose:
 *  - The browser is asked for a position ONLY when the rep taps «رتّب حسب
 *    الأقرب» or pins a shop, never on open and never in the background.
 *  - The rep's position is sent as a query parameter for ONE request, to sort
 *    that response. It is not stored, and no route or trail is kept.
 *  - The only coordinates written anywhere are the customer's shop, and every
 *    change goes to the audit log with the previous and the new point.
 *
 * Ordering is by area, or by straight-line distance when a position was given.
 * That is not a routing engine and does not pretend to be one — the data (no
 * roads, no traffic) cannot support a real route, so the screen says «الأقرب
 * بالخط المستقيم».
 */
import { lazy, Suspense, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "../../components/ui/button"
import { Card, CardContent } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { api } from "../../api/client"
import { QueryErrorBox } from "../../components/ui/query-error"
import { apiErrorMessage } from "../../utils/apiError"
import { openExternalUrl } from "../../utils/download"
import { toast } from "../../components/ui/use-toast"
import { AgentDialog, AgentEmptyState, AgentField, AgentLoading, AgentStatusPill } from "./shared"
import { money } from "./format"
import type { TodayVisit, VisitCustomer, VisitOutcome, VisitPlanEntry } from "./types"

const VisitMap = lazy(() => import("./VisitMap"))

const OUTCOMES: Array<{ code: VisitOutcome; label: string }> = [
  { code: "ORDERED", label: "أخذ طلب" },
  { code: "NO_ORDER", label: "ما طلب" },
  { code: "CLOSED", label: "المحل مغلق" },
  { code: "NEEDS_FOLLOW_UP", label: "يحتاج متابعة" },
  { code: "NOTE", label: "ملاحظة فقط" },
]

/** A position the rep granted for this one action. Never persisted. */
function askPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("هذا الجهاز ما يدعم تحديد الموقع"))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("ما وصلنا موقعك — تأكد من إذن الموقع بالمتصفح")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

/** External navigation, left to whatever map app the phone has. */
function mapsUrl(target: { latitude: number | null; longitude: number | null; address?: string | null; name: string }) {
  if (target.latitude != null && target.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${target.latitude},${target.longitude}`
  }
  const query = encodeURIComponent([target.name, target.address].filter(Boolean).join(" "))
  return `https://www.google.com/maps/search/?api=1&query=${query}`
}

const waUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "964")}`

export function VisitsScreen({
  areas,
  onOpenCustomer,
  onStartOrder,
}: {
  areas: string[]
  onOpenCustomer: (customerId: string) => void
  onStartOrder: (customerId: string) => void
}) {
  const qc = useQueryClient()
  const [area, setArea] = useState("")
  const [search, setSearch] = useState("")
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [ending, setEnding] = useState<{ visitId: string; name: string } | null>(null)
  const [pinning, setPinning] = useState<{
    id: string
    name: string
    address: string | null
    latitude: number | null
    longitude: number | null
  } | null>(null)
  const [outcome, setOutcome] = useState<VisitOutcome>("ORDERED")
  const [note, setNote] = useState("")

  const plan = useQuery({
    queryKey: ["sales-agent", "visit-plan"],
    queryFn: async () => {
      const res = await api.get<{ data: { date: string; entries: VisitPlanEntry[] } }>("/sales-agent/visits/plan")
      return res.data.data
    },
    retry: 3,
  })

  const customers = useQuery({
    queryKey: ["sales-agent", "visit-customers", area, search, origin?.lat ?? null, origin?.lng ?? null],
    queryFn: async () => {
      const res = await api.get<{ data: { customers: VisitCustomer[] } }>("/sales-agent/visits/customers", {
        params: {
          ...(area ? { area } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(origin ? { lat: origin.lat, lng: origin.lng } : {}),
          limit: 200,
        },
      })
      return res.data.data?.customers ?? []
    },
    retry: 3,
  })

  const today = useQuery({
    queryKey: ["sales-agent", "visits-today"],
    queryFn: async () => {
      const res = await api.get<{ data: { visits: TodayVisit[] } }>("/sales-agent/visits/today")
      return res.data.data?.visits ?? []
    },
    retry: 3,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["sales-agent", "visit-customers"] })
    void qc.invalidateQueries({ queryKey: ["sales-agent", "visits-today"] })
    void qc.invalidateQueries({ queryKey: ["sales-agent", "visit-plan"] })
  }

  const start = useMutation({
    networkMode: "always",
    mutationFn: async (input: { customerId: string; planId?: string }) => {
      // One key per visit start, so a double tap on a weak connection cannot
      // open the same visit twice.
      const res = await api.post("/sales-agent/visits", {
        customerId: input.customerId,
        ...(input.planId ? { planId: input.planId } : {}),
        clientRequestId: crypto.randomUUID(),
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "بدأت الزيارة" })
      refresh()
    },
    onError: (err) => toast({ title: "تعذر بدء الزيارة", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const end = useMutation({
    networkMode: "always",
    mutationFn: async (payload: { visitId: string; outcome: VisitOutcome; note: string }) => {
      const res = await api.post<{ data: { manualOutcome?: boolean } }>(
        `/sales-agent/visits/${payload.visitId}/end`,
        { outcome: payload.outcome, note: payload.note.trim() || undefined },
      )
      return res.data.data
    },
    onSuccess: (data) => {
      toast({
        title: "انتهت الزيارة وانسجلت النتيجة",
        // An «أخذ طلب» with no order behind it is a manual result and says so,
        // rather than being counted as a documented sale.
        description: data?.manualOutcome ? "نتيجة يدوية بدون طلب مرتبط" : undefined,
      })
      setEnding(null)
      setNote("")
      refresh()
    },
    onError: (err) => toast({ title: "تعذر إنهاء الزيارة", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const addToPlan = useMutation({
    networkMode: "always",
    mutationFn: async (customerId: string) => {
      const res = await api.post("/sales-agent/visits/plan", { customerId })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انضاف لخطة اليوم" })
      refresh()
    },
    onError: (err) => toast({ title: "تعذر الإضافة للخطة", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const pin = useMutation({
    networkMode: "always",
    mutationFn: async (payload: { customerId: string; lat: number; lng: number }) => {
      const res = await api.put(`/sales-agent/customers/${payload.customerId}/location`, {
        latitude: payload.lat,
        longitude: payload.lng,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انحفظ موقع المحل" })
      setPinning(null)
      refresh()
    },
    onError: (err) => toast({ title: "تعذر حفظ الموقع", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const sortByNearest = async () => {
    try {
      setOrigin(await askPosition())
      toast({ title: "رتّبنا خطة اليوم وزبائنك حسب الأقرب" })
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" })
    }
  }

  const pinHere = async (customerId: string) => {
    try {
      const position = await askPosition()
      pin.mutate({ customerId, lat: position.lat, lng: position.lng })
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" })
    }
  }

  // Memoised so the derived lists below do not rebuild on every render just
  // because `?? []` produced a new array.
  const entries = useMemo(() => plan.data?.entries ?? [], [plan.data])
  const planCustomerIds = useMemo(() => new Set(entries.map((e) => e.customerId)), [entries])
  const distanceOf = useMemo(() => {
    const byId = new Map((customers.data ?? []).map((c) => [c.id, c.distanceKm]))
    return (id: string) => byId.get(id) ?? null
  }, [customers.data])

  /** «رتب حسب الأقرب» sorts the PLAN first — it is the list the rep drives. */
  const sortByDistance = <T extends { customerId?: string; id: string }>(rows: T[]) => {
    if (!origin) return rows
    return [...rows].sort((a, b) => {
      const da = distanceOf(a.customerId ?? a.id)
      const db = distanceOf(b.customerId ?? b.id)
      if (da == null && db == null) return 0
      if (da == null) return 1
      if (db == null) return -1
      return da - db
    })
  }

  const pending = sortByDistance(entries.filter((e) => !e.visit?.endedAt && e.status !== "CANCELLED"))
  const done = entries.filter((e) => Boolean(e.visit?.endedAt))
  const offPlan = sortByDistance((customers.data ?? []).filter((c) => !planCustomerIds.has(c.id)))

  const pins = useMemo(() => {
    const rows = customers.data ?? []
    return rows
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => {
        const entry = entries.find((e) => e.customerId === c.id)
        return {
          id: c.id,
          name: c.name,
          latitude: c.latitude as number,
          longitude: c.longitude as number,
          visited: Boolean(entry?.visit?.endedAt ?? c.todayVisit?.endedAt),
          planned: Boolean(entry),
          distanceKm: c.distanceKm,
        }
      })
  }, [customers.data, entries])

  const withoutCoordinates = (customers.data ?? []).filter((c) => c.latitude == null || c.longitude == null).length

  const actionRow = (row: {
    id: string
    name: string
    phone: string
    address: string | null
    latitude: number | null
    longitude: number | null
    planId?: string
    visitId?: string | null
    visitEnded?: boolean
    onPlan: boolean
  }) => (
    <div className="flex flex-wrap gap-2">
      <Button className="h-11" variant="outline" onClick={() => onOpenCustomer(row.id)}>
        فتح الزبون
      </Button>
      {/* Desktop: a link out of the app only works through the OS shell. */}
      <Button className="h-11" variant="outline" onClick={() => void openExternalUrl(`tel:${row.phone}`)}>اتصال</Button>
      <Button className="h-11" variant="outline" onClick={() => void openExternalUrl(waUrl(row.phone))}>واتساب</Button>
      <Button className="h-11" variant="outline" onClick={() => void openExternalUrl(mapsUrl(row))}>افتح بالخرائط</Button>
      <Button className="h-11" variant="outline" onClick={() => onStartOrder(row.id)}>
        ابدأ طلب
      </Button>
      {row.visitId && !row.visitEnded ? (
        <Button
          className="h-11"
          onClick={() => {
            setEnding({ visitId: row.visitId as string, name: row.name })
            setOutcome("ORDERED")
            setNote("")
          }}
        >
          إنهاء الزيارة
        </Button>
      ) : row.visitEnded ? null : (
        <Button
          className="h-11"
          disabled={start.isPending}
          onClick={() => start.mutate({ customerId: row.id, planId: row.planId })}
        >
          بدء زيارة
        </Button>
      )}
      {!row.onPlan && (
        <Button className="h-11" variant="outline" disabled={addToPlan.isPending} onClick={() => addToPlan.mutate(row.id)}>
          أضف لخطة اليوم
        </Button>
      )}
      <Button
        className="h-11"
        variant="outline"
        onClick={() => setPinning({ id: row.id, name: row.name, address: row.address, latitude: row.latitude, longitude: row.longitude })}
      >
        {row.latitude == null ? "حدد موقع المحل" : "تصحيح موقع المحل"}
      </Button>
    </div>
  )

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-11 min-w-[12rem] flex-1"
          placeholder="ابحث باسم الزبون أو رقمه"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button className="h-11" variant="outline" onClick={() => void sortByNearest()}>
          رتّب حسب الأقرب
        </Button>
        <Button className="h-11" variant={showMap ? "default" : "outline"} onClick={() => setShowMap((v) => !v)}>
          {showMap ? "إخفاء الخريطة" : "عرض الخريطة"}
        </Button>
      </div>

      {origin && (
        <p className="text-[12px] text-slate-500">
          الترتيب حسب الأقرب بالخط المستقيم، مو حسب الطريق. موقعك استُخدم لهذا الترتيب فقط وما انحفظ.
        </p>
      )}

      {showMap && (
        <Suspense fallback={<AgentLoading label="جاري تحميل الخريطة…" />}>
          {pins.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-slate-500">
                ماكو زبون عنده موقع محدد بعد. افتح الزبون واضغط «حدد موقع المحل» وأنت واقف عنده.
              </CardContent>
            </Card>
          ) : (
            <VisitMap pins={pins} onPick={onOpenCustomer} />
          )}
        </Suspense>
      )}

      {/* ── خطة اليوم ─────────────────────────────────────────────── */}
      <section aria-labelledby="plan-pending">
        <h3 id="plan-pending" className="mb-2 text-[15px] font-semibold">
          خطة اليوم — باقي ({pending.length})
        </h3>
        {plan.isLoading ? (
          <AgentLoading label="جاري قراءة خطة اليوم…" />
        ) : plan.isError ? (
          <QueryErrorBox title="ما كدرنا نقرأ خطة اليوم" onRetry={() => void plan.refetch()} />
        ) : pending.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-slate-500">
              {entries.length === 0
                ? "ماكو خطة لليوم. تكدر تضيف زبائنك من القائمة تحت، أو صاحب المحل يعيّنها لك."
                : "خلصت خطة اليوم كلها — عافية."}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {pending.map((entry) => (
              <li key={entry.id}>
                <Card>
                  <CardContent className="space-y-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{entry.customerName}</p>
                        <p className="text-[12px] text-slate-500">
                          {[entry.area, entry.address].filter(Boolean).join(" · ") || "بلا عنوان"}
                          {distanceOf(entry.customerId) != null ? ` · ${distanceOf(entry.customerId)} كم` : ""}
                        </p>
                        {entry.note && <p className="text-[12px] text-slate-500">ملاحظة: {entry.note}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <AgentStatusPill tone={entry.visit ? "wait" : "muted"}>
                          {entry.visit && !entry.visit.endedAt ? "زيارة مفتوحة" : entry.statusLabel}
                        </AgentStatusPill>
                        {entry.currentBalance > 0 && (
                          <AgentStatusPill tone="wait">عليه {money(entry.currentBalance)}</AgentStatusPill>
                        )}
                      </div>
                    </div>
                    {actionRow({
                      id: entry.customerId,
                      name: entry.customerName,
                      phone: entry.customerPhone,
                      address: entry.address,
                      latitude: entry.latitude,
                      longitude: entry.longitude,
                      planId: entry.id,
                      visitId: entry.visit?.id ?? null,
                      visitEnded: Boolean(entry.visit?.endedAt),
                      onPlan: true,
                    })}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section aria-labelledby="plan-done">
          <h3 id="plan-done" className="mb-2 text-[15px] font-semibold">
            اكتملت اليوم ({done.length})
          </h3>
          <ul className="space-y-2">
            {done.map((entry) => (
              <li key={entry.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-semibold">{entry.customerName}</p>
                  <AgentStatusPill tone={entry.visit?.orderLinked ? "ok" : "muted"}>
                    {entry.visit?.outcomeLabel ?? "منتهية"}
                  </AgentStatusPill>
                </div>
                {entry.visit?.manualOutcome && (
                  <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
                    نتيجة يدوية بدون طلب مرتبط
                  </p>
                )}
                {entry.visit?.orderLinked && (
                  <p className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300">مرتبطة بطلب فعلي</p>
                )}
                {entry.visit?.note && <p className="mt-1 text-[12px] text-slate-500">{entry.visit.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── زبائن خارج الخطة ──────────────────────────────────────── */}
      <section aria-labelledby="off-plan">
        <h3 id="off-plan" className="mb-2 text-[15px] font-semibold">
          زبائن خارج خطة اليوم ({offPlan.length})
        </h3>

        <div className="mb-2 flex flex-wrap gap-2">
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

        {withoutCoordinates > 0 && (
          <p className="mb-2 text-[12px] text-slate-500">
            {withoutCoordinates} زبون بلا موقع محدد — يظهرون بالقائمة مع عنوانهم، وتكدر تحدد موقعهم.
          </p>
        )}

        {customers.isLoading ? (
          <AgentLoading />
        ) : customers.isError ? (
          <QueryErrorBox title="ما كدرنا نقرأ زبائنك" onRetry={() => void customers.refetch()} />
        ) : offPlan.length === 0 ? (
          <AgentEmptyState title="كل زبائن هذا الفلتر داخل الخطة" body="غيّر المنطقة أو امسح البحث." />
        ) : (
          <ul className="space-y-2">
            {offPlan.map((customer) => (
              <li key={customer.id}>
                <Card>
                  <CardContent className="space-y-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{customer.name}</p>
                        <p className="text-[12px] text-slate-500">
                          {[customer.area, customer.address].filter(Boolean).join(" · ") || "بلا عنوان"}
                          {customer.distanceKm != null ? ` · ${customer.distanceKm} كم` : ""}
                        </p>
                      </div>
                      {customer.currentBalance > 0 && (
                        <AgentStatusPill tone="wait">عليه {money(customer.currentBalance)}</AgentStatusPill>
                      )}
                    </div>
                    {actionRow({
                      id: customer.id,
                      name: customer.name,
                      phone: customer.phone,
                      address: customer.address,
                      latitude: customer.latitude,
                      longitude: customer.longitude,
                      visitId: customer.todayVisit?.id ?? null,
                      visitEnded: Boolean(customer.todayVisit?.endedAt),
                      onPlan: false,
                    })}
                    {customer.todayVisit?.endedAt && (
                      <p className="text-[12px] text-emerald-700 dark:text-emerald-300">
                        زيارة اليوم: {customer.todayVisit.outcomeLabel ?? "منتهية"}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {today.isError && <QueryErrorBox title="ما كدرنا نقرأ زيارات اليوم" onRetry={() => void today.refetch()} />}

      {ending && (
        <AgentDialog
          title="نتيجة الزيارة"
          onClose={() => setEnding(null)}
          footer={
            <Button
              className="h-12 w-full"
              disabled={end.isPending}
              onClick={() => end.mutate({ visitId: ending.visitId, outcome, note })}
            >
              {end.isPending ? "جاري الحفظ…" : "حفظ النتيجة"}
            </Button>
          }
        >
          <p className="font-semibold">{ending.name}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {OUTCOMES.map((option) => (
              <Button
                key={option.code}
                className="h-11"
                variant={outcome === option.code ? "default" : "outline"}
                onClick={() => setOutcome(option.code)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {outcome === "ORDERED" && (
            <p className="mt-3 rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              إذا أرسلت الطلب وأنت بهذي الزيارة، يرتبط بها تلقائياً. إذا ما أرسلت طلباً، تنسجل «نتيجة يدوية بدون طلب
              مرتبط» — تكدر تسجلها، بس ما تُحسب بيعاً موثقاً.
            </p>
          )}
          <div className="mt-4">
            <AgentField label="ملاحظة (اختياري)">
              <Input className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
            </AgentField>
          </div>
        </AgentDialog>
      )}

      {pinning && (
        <AgentDialog
          title={pinning.latitude == null ? "حدد موقع المحل" : "تصحيح موقع المحل"}
          onClose={() => setPinning(null)}
          footer={
            <Button className="h-12 w-full" disabled={pin.isPending} onClick={() => void pinHere(pinning.id)}>
              {pin.isPending
                ? "جاري الحفظ…"
                : pinning.latitude == null
                  ? "احفظ موقعي الحالي كموقع المحل"
                  : "استبدل الموقع بموقعي الحالي"}
            </Button>
          }
        >
          <p className="font-semibold">{pinning.name}</p>
          <p className="mt-2 text-sm">
            انحفظ موقع <span className="font-semibold">المحل</span>، مو موقعك. استخدم هذا الزر وأنت واقف عند المحل.
            ما نحفظ تحركاتك ولا نتابع موقعك بالخلفية.
          </p>
          {pinning.latitude != null && (
            <>
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                هذا الزبون عنده موقع محفوظ. الاستبدال يشيل الموقع القديم — تأكد منه أول.
              </p>
              <Button
                className="mt-2 h-11"
                variant="outline"
                onClick={() => void openExternalUrl(mapsUrl({ ...pinning, name: pinning.name }))}
              >
                افتح الموقع الحالي للتحقق
              </Button>
            </>
          )}
          {pinning.address && <p className="mt-2 text-[12px] text-slate-500">العنوان المسجّل: {pinning.address}</p>}
          <p className="mt-2 text-[12px] text-slate-500">كل تغيير للموقع ينسجل بسجل التدقيق باسمك وبالموقع القديم.</p>
        </AgentDialog>
      )}
    </div>
  )
}
