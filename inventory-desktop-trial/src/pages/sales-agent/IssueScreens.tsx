import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Check, Loader2 } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table"
import { toast } from "../../components/ui/use-toast"
import { QueryErrorBox } from "../../components/ui/query-error"
import { apiErrorMessage } from "../../utils/apiError"
import { UNIT_LABEL, money, shortDate } from "./format"
import { type Unit, type AgentProduct, type AgentIssue, type AgentPriceRequest, type IssueReason, unitPrice, digitsOnly } from "./model"
import { Dialog, Field, StatusPill, Waiting } from "./ui"
import { useOnce } from "./hooks"

/**
 * Why the shopkeeper said no.
 *
 * One tap on a fixed reason and the rep is done — free text alone would be
 * unreportable. The two optional fields carry the value: a note, and «من من
 * يشتريه وبأي سعر؟», which turns a lost sale into competitor pricing.
 */
export function IssueDialog({
  product,
  unit,
  customerId,
  customerName,
  onClose,
}: {
  product: AgentProduct | null
  unit: Unit | null
  customerId: string
  customerName: string
  onClose: () => void
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [competitorInfo, setCompetitorInfo] = useState("")

  const reasons = useQuery({
    queryKey: ["sales-agent", "issue-reasons"],
    queryFn: async () => {
      const res = await api.get<{ data: IssueReason[] }>("/sales-agent/issue-reasons")
      return res.data.data ?? []
    },
    staleTime: 60 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent/issues", {
        customerId,
        productId: product?.id,
        reason,
        note: note.trim() || undefined,
        competitorInfo: competitorInfo.trim() || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انسجلت المشكلة ✓" })
      onClose()
    },
    onError: (err) =>
      toast({ title: "ما انسجلت", description: apiErrorMessage(err, "حاول مرة أخرى"), variant: "destructive" }),
  })

  const saveOnce = useOnce(save)

  return (
    <Dialog
      title="أكو مشكلة"
      onClose={onClose}
      footer={
        <Button className="h-11 w-full" disabled={!reason || save.isPending} onClick={saveOnce}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {save.isPending ? "جاري الحفظ…" : "احفظ"}
        </Button>
      }
    >
      <p className="rounded bg-slate-100 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {customerName}
        {product ? ` — ${product.name}` : ""}
        {unit ? ` (${UNIT_LABEL[unit]})` : ""}
      </p>

      <div className="mt-4 grid gap-2">
        {(reasons.data ?? []).map((r) => (
          <Button
            key={r.code}
            variant={reason === r.code ? "default" : "outline"}
            className="h-11 w-full justify-between"
            onClick={() => setReason(r.code)}
          >
            {r.label}
            {reason === r.code && <Check className="h-4 w-4" />}
          </Button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <Field label="ملاحظة (اختياري)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </Field>
        <Field label="من من يشتريه وبأي سعر؟">
          <textarea
            value={competitorInfo}
            onChange={(e) => setCompetitorInfo(e.target.value)}
            placeholder="اسم المجهز والسعر…"
            rows={2}
            className="w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </Field>
      </div>
    </Dialog>
  )
}

/**
 * The rep cannot discount, so this is the only route to a different price. It
 * goes to the same approvals screen as everything else, and an approved price is
 * spent on one order — it never becomes the customer's standing price.
 */
export function PriceRequestDialog({
  product,
  unit,
  customerId,
  customerName,
  onClose,
}: {
  product: AgentProduct
  unit: Unit
  customerId: string
  customerName: string
  onClose: () => void
}) {
  const [price, setPrice] = useState("")
  const [reason, setReason] = useState("")
  const current = unitPrice(product, unit)

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent/price-requests", {
        customerId,
        productId: product.id,
        unit,
        requestedPrice: Number(price),
        reason: reason.trim() || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انرسل طلب السعر ✓", description: "راح يوصلك جواب بعد الموافقة" })
      onClose()
    },
    onError: (err) =>
      toast({ title: "ما انرسل", description: apiErrorMessage(err, "حاول مرة أخرى"), variant: "destructive" }),
  })

  const saveOnce = useOnce(save)

  return (
    <Dialog
      title="اطلب سعراً خاصاً"
      onClose={onClose}
      footer={
        <Button
          className="h-11 w-full"
          disabled={!(Number(price) > 0) || save.isPending}
          onClick={saveOnce}
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {save.isPending ? "جاري الإرسال…" : "أرسل الطلب"}
        </Button>
      }
    >
      <p className="rounded bg-slate-100 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {customerName} — {product.name} ({UNIT_LABEL[unit]})
      </p>

      <p className="mt-3 text-[13px] text-slate-500">
        السعر الحالي <span className="font-bold tabular-nums text-[var(--theme-textPrimary)]">{money(current)}</span>
      </p>

      <div className="mt-4 space-y-3">
        <Field label="السعر المطلوب">
          <Input
            value={price}
            inputMode="numeric"
            onChange={(e) => setPrice(digitsOnly(e.target.value))}
            className="h-11 text-lg font-bold tabular-nums"
          />
        </Field>
        <Field label="السبب">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ليش يستاهل سعر خاص؟"
            rows={3}
            className="w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </Field>
      </div>

      <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        إذا انوافق، ينطبق على هذا الطلب فقط — ما يصير سعر دائم للزبون.
      </p>
    </Dialog>
  )
}

/* ── the rep's own issues + price requests ───────────────────────────── */

const PRICE_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" }> = {
  PENDING: { label: "بانتظار الموافقة", tone: "wait" },
  APPROVED: { label: "موافق عليه", tone: "ok" },
  REJECTED: { label: "مرفوض", tone: "bad" },
}

export function MyIssuesScreen() {
  const issues = useQuery({
    queryKey: ["sales-agent", "issues"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentIssue[] }>("/sales-agent/issues")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const prices = useQuery({
    queryKey: ["sales-agent", "price-requests"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentPriceRequest[] }>("/sales-agent/price-requests")
      return res.data.data ?? []
    },
    retry: 3,
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>طلبات الأسعار</CardTitle>
        </CardHeader>
        <CardContent>
          {prices.isPending ? (
            <Waiting q={prices} />
          ) : prices.error ? (
            <QueryErrorBox title="ما وصلت طلبات الأسعار" onRetry={() => void prices.refetch()} />
          ) : (prices.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما طلبت أسعار</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المادة</TH>
                  <TH>الزبون</TH>
                  <TH>السعر</TH>
                  <TH>الحالة</TH>
                </TR>
              </THead>
              <TBody>
                {(prices.data ?? []).map((p) => {
                  const s = PRICE_STATUS[p.status] ?? { label: p.status, tone: "wait" as const }
                  return (
                    <TR key={p.id}>
                      <TD className="font-medium">{p.productName}</TD>
                      <TD>{p.customerName}</TD>
                      <TD className="tabular-nums">
                        {money(p.currentPrice)} ← {money(p.requestedPrice)}
                      </TD>
                      <TD>
                        <StatusPill tone={s.tone}>{s.label}</StatusPill>
                        {p.used && <span className="ms-1 text-[12px] text-slate-500">انستعمل</span>}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>المشاكل الي سجّلتها</CardTitle>
        </CardHeader>
        <CardContent>
          {issues.isPending ? (
            <Waiting q={issues} />
          ) : issues.error ? (
            <QueryErrorBox title="ما وصلت المشاكل" onRetry={() => void issues.refetch()} />
          ) : (issues.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما سجّلت مشاكل</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ</TH>
                  <TH>الزبون</TH>
                  <TH>المادة</TH>
                  <TH>السبب</TH>
                  <TH>المنافس</TH>
                </TR>
              </THead>
              <TBody>
                {(issues.data ?? []).map((i) => (
                  <TR key={i.id}>
                    <TD className="tabular-nums">{shortDate(i.createdAt)}</TD>
                    <TD className="font-medium">{i.customerName}</TD>
                    <TD>{i.productName ?? "—"}</TD>
                    <TD>
                      <StatusPill tone="muted">{i.reasonLabel}</StatusPill>
                      {i.note && <p className="mt-1 text-[12px] text-slate-500">{i.note}</p>}
                    </TD>
                    <TD className="text-[12px] text-slate-500">{i.competitorInfo ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ── customer detail ─────────────────────────────────────────────────── */
