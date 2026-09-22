/**
 * «عروض خاصة بالزبون» — the owner's screen for standing customer prices.
 *
 * One row per (customer, product, unit, price basis): the database enforces
 * that with a unique index, which is why there is no "which offer wins?"
 * question anywhere in this feature. Extending or reviving an offer edits the
 * row that already exists.
 *
 * Nothing here prices an order. The final price is decided on the server at
 * review time, in this documented order: an approved price request first, then
 * a live offer, then the ordinary carton/wholesale price.
 */
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api/client"
import { getCustomersPaged } from "../api/endpoints"
import { getProducts } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { QueryErrorBox } from "../components/ui/query-error"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { AgentDialog, AgentField, AgentStatusPill } from "./sales-agent/shared"
import { money } from "./sales-agent/format"
import type { CustomerOffer } from "./sales-agent/types"
import type { AgentMode, AgentUnit } from "../utils/salesAgentDrafts"

const UNITS: Array<{ value: AgentUnit; label: string }> = [
  { value: "PIECE", label: "قطعة" },
  { value: "DOZEN", label: "دزينة" },
  { value: "BOX", label: "علبة" },
  { value: "CARTON", label: "كارتون" },
]

const STATE_LABEL: Record<CustomerOffer["state"], { label: string; tone: "ok" | "wait" | "bad" | "muted" }> = {
  LIVE: { label: "فعّال", tone: "ok" },
  SCHEDULED: { label: "لم يبدأ بعد", tone: "wait" },
  PAUSED: { label: "متوقف", tone: "muted" },
  EXPIRED: { label: "منتهي", tone: "bad" },
}

/**
 * Dates are sent and received as plain `YYYY-MM-DD` days.
 *
 * The server turns a picked day into an instant in the SHOP's timezone, and
 * sends back the days it resolved (`startsOnDate` / `endsOnDate`). Nothing here
 * builds a Date out of a date string: `new Date("2026-09-25")` is midnight UTC,
 * which in Baghdad is already the 25th at 03:00 — enough to shift the day.
 */
const todayInput = () => {
  const now = new Date()
  // Local calendar parts, not toISOString(), which would shift the day for
  // anyone east of UTC late in the evening.
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

const addDaysToKey = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number)
  // UTC arithmetic on the calendar parts only — never rendered as an instant.
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return shifted.toISOString().slice(0, 10)
}

type FormState = {
  customerId: string
  customerName: string
  productId: string
  productName: string
  unit: AgentUnit
  priceMode: AgentMode
  discountType: "AMOUNT" | "PERCENT"
  fixedPrice: string
  discountPercent: string
  startsAt: string
  endsAt: string
  note: string
}

const emptyForm = (): FormState => ({
  customerId: "",
  customerName: "",
  productId: "",
  productName: "",
  unit: "CARTON",
  priceMode: "WHOLESALE",
  discountType: "AMOUNT",
  fixedPrice: "",
  discountPercent: "",
  startsAt: todayInput(),
  // A week, not today: an end equal to the start is a zero-length window, and
  // the form used to open already invalid with the save button dead.
  endsAt: addDaysToKey(todayInput(), 7),
  note: "",
})

export function CustomerOffersPage() {
  const qc = useQueryClient()
  const [liveOnly, setLiveOnly] = useState(false)
  const [customerFilter, setCustomerFilter] = useState("")
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CustomerOffer | null>(null)

  const offers = useQuery({
    queryKey: ["customer-offers", liveOnly],
    queryFn: async () => {
      const res = await api.get<{ data: { offers: CustomerOffer[]; total: number } }>("/customer-offers", {
        params: { ...(liveOnly ? { liveOnly: true } : {}), limit: 200 },
      })
      return res.data.data
    },
    retry: 3,
  })

  const rows = useMemo(() => {
    const all = offers.data?.offers ?? []
    const term = customerFilter.trim()
    if (!term) return all
    return all.filter((o) => o.customerName.includes(term) || o.productName.includes(term))
  }, [offers.data, customerFilter])

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["customer-offers"] })
    // The rep's screens read the same offers.
    void qc.invalidateQueries({ queryKey: ["sales-agent"] })
  }

  // A fixed price above the shelf price is allowed but never accidental: the
  // server refuses it once, and this holds the write until the owner confirms.
  const [confirmAbove, setConfirmAbove] = useState<{
    payload: { id?: string; body: Record<string, unknown> }
    message: string
  } | null>(null)

  const save = useMutation({
    mutationFn: async (payload: { id?: string; body: Record<string, unknown> }) => {
      const res = payload.id
        ? await api.put(`/customer-offers/${payload.id}`, payload.body)
        : await api.post("/customer-offers", payload.body)
      return res.data
    },
    onSuccess: (_data, variables) => {
      toast({ title: variables.id ? "انحدّث العرض" : "انضاف العرض" })
      setCreating(false)
      setEditing(null)
      setConfirmAbove(null)
      invalidate()
    },
    onError: (err, variables) => {
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code
      if (code === "OFFER_ABOVE_CATALOG_UNCONFIRMED") {
        setConfirmAbove({ payload: variables, message: apiErrorMessage(err) })
        return
      }
      toast({ title: "تعذر حفظ العرض", description: apiErrorMessage(err), variant: "destructive" })
    },
  })

  const toggle = useMutation({
    mutationFn: async (payload: { id: string; isActive: boolean }) => {
      const res = await api.patch(`/customer-offers/${payload.id}/active`, { isActive: payload.isActive })
      return res.data
    },
    onSuccess: (_data, variables) => {
      toast({ title: variables.isActive ? "انشغّل العرض" : "انوقف العرض" })
      invalidate()
    },
    onError: (err) => toast({ title: "تعذر تغيير حالة العرض", description: apiErrorMessage(err), variant: "destructive" }),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>عروض خاصة بالزبون</CardTitle>
          <Button className="h-11" onClick={() => setCreating(true)}>عرض جديد</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500">
            العرض يخص زبوناً واحداً ومادة واحدة ووحدة واحدة ونوع سعر واحد. بعد تاريخ النهاية يرجع السعر الطبيعي
            تلقائياً بدون أي خطوة. السعر النهائي يحسبه السيرفر وقت المراجعة، وترتيب الأولوية: السعر المعتمد بطلب
            موافقة، ثم العرض، ثم سعر الجملة أو توزيع الكراتين.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-11 min-w-[14rem] flex-1"
              placeholder="بحث باسم الزبون أو المادة"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
            />
            <Button className="h-11" variant={liveOnly ? "default" : "outline"} onClick={() => setLiveOnly((v) => !v)}>
              الفعّالة فقط
            </Button>
          </div>

          {offers.isError ? (
            <QueryErrorBox title="ما وصلت قائمة العروض" onRetry={() => void offers.refetch()} />
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {offers.isPending ? "جاري التحميل…" : "ماكو عروض بهذا الفلتر."}
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((offer) => {
                const state = STATE_LABEL[offer.state]
                return (
                  <li
                    key={offer.id}
                    className={cn("rounded-lg border p-3")}
                    style={{ borderColor: "var(--theme-cardBorder)" }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{offer.customerName}</p>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          {offer.productName} · {UNITS.find((u) => u.value === offer.unit)?.label} ·{" "}
                          {offer.priceMode === "CARTON" ? "توزيع كراتين" : "جملة"}
                        </p>
                      </div>
                      <AgentStatusPill tone={state.tone}>{state.label}</AgentStatusPill>
                    </div>

                    <p className="mt-2 text-sm">
                      {offer.discountType === "PERCENT"
                        ? `خصم ${offer.discountPercent}%`
                        : `سعر خاص ${money(offer.fixedPrice ?? 0)}`}
                      {" · "}
                      السعر الطبيعي {money(offer.catalogPrice)}
                      {" · "}
                      {offer.offerPrice === null ? (
                        <span className="text-amber-700">غير قابل للتطبيق — راجع الأرقام</span>
                      ) : (
                        <span className="font-semibold">صافي {money(offer.offerPrice)}</span>
                      )}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      من بداية يوم {offer.startsOnDate} · فعال لغاية نهاية يوم {offer.endsOnDate}
                      {offer.note ? ` · ${offer.note}` : ""}
                    </p>
                    {offer.aboveCatalog && (
                      <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
                        هذا العرض أعلى من سعر الكتلوگ — مثبّت هكذا بتأكيد الإدارة.
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button className="h-11" variant="outline" onClick={() => setEditing(offer)}>
                        تعديل
                      </Button>
                      <Button
                        className="h-11"
                        variant="outline"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: offer.id, isActive: !offer.isActive })}
                      >
                        {offer.isActive ? "إيقاف" : "تشغيل"}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {creating && (
        <OfferDialog
          title="عرض جديد"
          saving={save.isPending}
          onClose={() => setCreating(false)}
          onSave={(form) =>
            save.mutate({
              body: {
                customerId: form.customerId,
                productId: form.productId,
                unit: form.unit,
                priceMode: form.priceMode,
                discountType: form.discountType,
                fixedPrice: form.discountType === "AMOUNT" ? Number(form.fixedPrice) : null,
                discountPercent: form.discountType === "PERCENT" ? Number(form.discountPercent) : null,
                startsAt: form.startsAt,
                endsAt: form.endsAt,
                note: form.note || null,
              },
            })
          }
        />
      )}

      {confirmAbove && (
        <AgentDialog
          title="سعر أعلى من الكتلوگ"
          onClose={() => setConfirmAbove(null)}
          footer={
            <div className="flex gap-2">
              <Button className="h-12 flex-1" variant="outline" onClick={() => setConfirmAbove(null)}>
                رجوع وتعديل السعر
              </Button>
              <Button
                className="h-12 flex-1"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    ...confirmAbove.payload,
                    body: { ...confirmAbove.payload.body, confirmAboveCatalog: true },
                  })
                }
              >
                نعم، اثبت هذا السعر
              </Button>
            </div>
          }
        >
          <p className="text-sm">{confirmAbove.message}</p>
          <p className="mt-2 text-[12px] text-slate-500">
            بعض الاتفاقات فعلاً أعلى من سعر الكتلوگ، فالنظام يسمح بهذا. السعر يُخزن بالضبط كما أدخلته، بدون أي تعديل
            صامت.
          </p>
        </AgentDialog>
      )}

      {editing && (
        <OfferDialog
          title="تعديل العرض"
          saving={save.isPending}
          existing={editing}
          onClose={() => setEditing(null)}
          onSave={(form) =>
            save.mutate({
              id: editing.id,
              body: {
                discountType: form.discountType,
                fixedPrice: form.discountType === "AMOUNT" ? Number(form.fixedPrice) : null,
                discountPercent: form.discountType === "PERCENT" ? Number(form.discountPercent) : null,
                startsAt: form.startsAt,
                endsAt: form.endsAt,
                isActive: editing.isActive,
                note: form.note || null,
              },
            })
          }
        />
      )}
    </div>
  )
}

/**
 * One dialog for both create and edit.
 *
 * On edit the customer, product, unit and price basis are shown but not
 * editable: changing them would rewrite whose price this was, which is a
 * different offer and not an edit of this one.
 */
function OfferDialog({
  title,
  existing,
  saving,
  onClose,
  onSave,
}: {
  title: string
  existing?: CustomerOffer
  saving: boolean
  onClose: () => void
  onSave: (form: FormState) => void
}) {
  const [form, setForm] = useState<FormState>(() =>
    existing
      ? {
          customerId: existing.customerId,
          customerName: existing.customerName,
          productId: existing.productId,
          productName: existing.productName,
          unit: existing.unit,
          priceMode: existing.priceMode,
          discountType: existing.discountType,
          fixedPrice: existing.fixedPrice == null ? "" : String(existing.fixedPrice),
          discountPercent: existing.discountPercent == null ? "" : String(existing.discountPercent),
          // The days the SERVER resolved in shop time, not a re-derivation of
          // the exclusive instant in the browser's zone.
          startsAt: existing.startsOnDate,
          endsAt: existing.endsOnDate,
          note: existing.note ?? "",
        }
      : emptyForm(),
  )
  const [customerSearch, setCustomerSearch] = useState("")
  const [productSearch, setProductSearch] = useState("")

  const customers = useQuery({
    queryKey: ["customer-offers", "customer-picker", customerSearch],
    enabled: !existing && customerSearch.trim().length >= 2,
    queryFn: async () => (await getCustomersPaged({ search: customerSearch.trim(), limit: 20 })).data ?? [],
  })

  const products = useQuery({
    queryKey: ["customer-offers", "product-picker", productSearch],
    enabled: !existing && productSearch.trim().length >= 2,
    queryFn: async () => await getProducts({ search: productSearch.trim(), limit: 20 }),
  })

  const ready =
    Boolean(form.customerId && form.productId && form.startsAt && form.endsAt) &&
    (form.discountType === "AMOUNT" ? Number(form.fixedPrice) > 0 : Number(form.discountPercent) > 0)

  return (
    <AgentDialog
      title={title}
      onClose={onClose}
      footer={
        <Button className="h-12 w-full" disabled={!ready || saving} onClick={() => onSave(form)}>
          {saving ? "جاري الحفظ…" : "حفظ العرض"}
        </Button>
      }
    >
      <div className="space-y-4">
        {existing ? (
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <p className="font-semibold">{existing.customerName}</p>
            <p className="text-slate-600 dark:text-slate-300">
              {existing.productName} · {UNITS.find((u) => u.value === existing.unit)?.label} ·{" "}
              {existing.priceMode === "CARTON" ? "توزيع كراتين" : "جملة"}
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              الزبون والمادة والوحدة ونوع السعر ما تتغير بالتعديل — هذي عرض ثاني، مو تعديل لهذا العرض.
            </p>
          </div>
        ) : (
          <>
            <AgentField label="الزبون">
              <Input
                className="h-11"
                placeholder="اكتب حرفين على الأقل من اسم الزبون"
                value={form.customerId ? form.customerName : customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value)
                  setForm((f) => ({ ...f, customerId: "", customerName: "" }))
                }}
              />
            </AgentField>
            {!form.customerId && (customers.data ?? []).length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {(customers.data ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border p-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => setForm((f) => ({ ...f, customerId: c.id, customerName: c.name }))}
                    >
                      {c.name} · <span dir="ltr">{c.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <AgentField label="المادة">
              <Input
                className="h-11"
                placeholder="اكتب حرفين على الأقل من اسم المادة"
                value={form.productId ? form.productName : productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value)
                  setForm((f) => ({ ...f, productId: "", productName: "" }))
                }}
              />
            </AgentField>
            {!form.productId && (products.data ?? []).length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {(products.data ?? []).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border p-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => setForm((f) => ({ ...f, productId: p.id, productName: p.name }))}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <AgentField label="نوع السعر">
              <div className="flex gap-2">
                {(["WHOLESALE", "CARTON"] as const).map((value) => (
                  <Button
                    key={value}
                    className="h-11 flex-1"
                    variant={form.priceMode === value ? "default" : "outline"}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        priceMode: value,
                        // Distribution sells whole cartons only, here as everywhere.
                        unit: value === "CARTON" ? "CARTON" : f.unit,
                      }))
                    }
                  >
                    {value === "WHOLESALE" ? "جملة" : "توزيع كراتين"}
                  </Button>
                ))}
              </div>
            </AgentField>

            <AgentField label="الوحدة">
              <div className="flex flex-wrap gap-2">
                {UNITS.map((unit) => (
                  <Button
                    key={unit.value}
                    className="h-11"
                    variant={form.unit === unit.value ? "default" : "outline"}
                    disabled={form.priceMode === "CARTON" && unit.value !== "CARTON"}
                    onClick={() => setForm((f) => ({ ...f, unit: unit.value }))}
                  >
                    {unit.label}
                  </Button>
                ))}
              </div>
            </AgentField>
          </>
        )}

        <p className="rounded-lg bg-slate-50 p-3 text-[12px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          التواريخ بتوقيت المحل: العرض يبدأ من بداية يوم البداية، ويبقى فعالاً لغاية نهاية يوم النهاية.
        </p>

        <AgentField label="شكل العرض">
          <div className="flex gap-2">
            {([["AMOUNT", "سعر خاص ثابت"], ["PERCENT", "خصم بالنسبة"]] as const).map(([value, label]) => (
              <Button
                key={value}
                className="h-11 flex-1"
                variant={form.discountType === value ? "default" : "outline"}
                onClick={() => setForm((f) => ({ ...f, discountType: value }))}
              >
                {label}
              </Button>
            ))}
          </div>
        </AgentField>

        {form.discountType === "AMOUNT" ? (
          <AgentField label="السعر الخاص للوحدة">
            <Input
              className="h-11"
              inputMode="numeric"
              value={form.fixedPrice}
              onChange={(e) => setForm((f) => ({ ...f, fixedPrice: e.target.value.replace(/[^\d.]/g, "") }))}
            />
          </AgentField>
        ) : (
          <AgentField label="نسبة الخصم %">
            <Input
              className="h-11"
              inputMode="numeric"
              value={form.discountPercent}
              onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value.replace(/[^\d.]/g, "") }))}
            />
          </AgentField>
        )}

        <div className="grid grid-cols-2 gap-3">
          <AgentField label="من تاريخ">
            <Input
              className="h-11"
              type="date"
              value={form.startsAt}
              onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
            />
          </AgentField>
          <AgentField label="إلى تاريخ">
            <Input
              className="h-11"
              type="date"
              value={form.endsAt}
              onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
            />
          </AgentField>
        </div>

        <AgentField label="ملاحظة (اختياري)">
          <Input
            className="h-11"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </AgentField>
      </div>
    </AgentDialog>
  )
}
