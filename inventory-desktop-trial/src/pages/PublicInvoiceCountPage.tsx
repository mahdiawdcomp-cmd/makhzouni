// «جرد الفاتورة» — the public counting page.
//
// Opened from a link sent to a preparation worker (count before the load leaves
// the shop) or to the customer (count on arrival). No login: the link itself is
// the credential, and it is single-use and short-lived.
//
// The page deliberately looks like the shop's own invoice — same logo, accent,
// header fields and columns — with ONE column added: «الواصل». The exact printed
// design is one tap away, so the counter can compare against the real document.
import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { AlertTriangle, Check, CheckCircle2, FileText, Loader2, Lock, X } from "lucide-react"

import { api } from "../api/client"
import { cn } from "../utils/cn"
import { parseDesigns, renderDesignHTML, type PrintInvoice } from "../print/invoiceDesign"

// ── Types (mirror of the backend CountLinkView) ──────────────────────────────

interface CountLine {
  itemId: string
  productId: string
  productName: string
  itemNumber: string | null
  unit: string
  unitLabel: string
  quantity: number
  expectedPieces: number
  pcsPerCarton: number
  boxPieces: number | null
  unitPrice: number
  totalPrice: number
  notes: string | null
}

interface CountLinkView {
  token: string
  audience: "WORKER" | "CUSTOMER"
  recipientName: string
  expiresAt: string
  blocked: { reason: string; message: string } | null
  editingBy: string | null
  invoice: {
    id: string
    invoiceNumber: string
    date: string
    type: string
    customerName: string
    customerPhone: string | null
    paymentType: string
    notes: string | null
    subtotal: number
    discount: number
    tax: number
    totalAmount: number
    paidAmount: number
    remainingAmount: number
    previousBalance: number
    finalBalance: number
    lines: CountLine[]
  }
  store: {
    storeName: string
    storeLogo: string | null
    storePhone: string | null
    storeAddress: string | null
    currency: string
    invoiceDesign: string | null
  }
}

// ── Per-line answer ──────────────────────────────────────────────────────────
// `null` means "not answered yet" and is what keeps the submit button locked.
// Zero is a real answer — «ما وصلني» — and must never look like a blank.
interface Answer {
  cartons: string
  pieces: string
  full: boolean
}

const EMPTY: Answer = { cartons: "", pieces: "", full: false }

function answeredPieces(line: CountLine, answer: Answer | undefined): number | null {
  if (!answer) return null
  if (answer.full) return line.expectedPieces
  const hasCartons = answer.cartons.trim() !== ""
  const hasPieces = answer.pieces.trim() !== ""
  if (!hasCartons && !hasPieces) return null
  const cartons = hasCartons ? Number(answer.cartons) : 0
  const pieces = hasPieces ? Number(answer.pieces) : 0
  if (!Number.isFinite(cartons) || !Number.isFinite(pieces) || cartons < 0 || pieces < 0) return null
  return Math.round(cartons * Math.max(1, line.pcsPerCarton) + pieces)
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US")

function paymentLabel(type: string) {
  if (type === "CASH") return "نقد"
  if (type === "PARTIAL") return "جزئي"
  return "أجل"
}

// ── Data ─────────────────────────────────────────────────────────────────────

async function fetchLink(token: string): Promise<CountLinkView> {
  const { data } = await api.get(`/public/invoice-count/${token}`)
  return (data as { data: CountLinkView }).data
}

async function fetchStatus(token: string): Promise<{ blocked: CountLinkView["blocked"]; editingBy: string | null }> {
  const { data } = await api.get(`/public/invoice-count/${token}/status`)
  return (data as { data: { blocked: CountLinkView["blocked"]; editingBy: string | null } }).data
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function PublicInvoiceCountPage() {
  const { token = "" } = useParams<{ token: string }>()
  const queryClient = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [showDesigned, setShowDesigned] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState<{ hasDifference: boolean; differenceCount: number } | null>(null)

  const linkQ = useQuery({
    queryKey: ["public-invoice-count", token],
    queryFn: () => fetchLink(token),
    enabled: !!token,
    retry: 1,
  })

  // Watch the shop: while someone has the invoice open for editing, counting is
  // held back rather than racing a document being rewritten underneath.
  const statusQ = useQuery({
    queryKey: ["public-invoice-count-status", token],
    queryFn: () => fetchStatus(token),
    enabled: !!token && !!linkQ.data && !linkQ.data.blocked && !done,
    refetchInterval: 10_000,
    // The app disables focus-refetching globally and caches for five minutes.
    // Neither is right for a lock the counter is waiting on: coming back to the
    // tab must clear the overlay at once, not on the next tick.
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  const view = linkQ.data
  const editingBy = statusQ.data?.editingBy ?? view?.editingBy ?? null
  const blocked = statusQ.data?.blocked ?? view?.blocked ?? null

  const lines = view?.invoice.lines ?? []
  const remaining = useMemo(
    () => lines.filter((line) => answeredPieces(line, answers[line.itemId]) === null).length,
    [lines, answers],
  )

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload = lines.map((line) => ({
        itemId: line.itemId,
        receivedPieces: answeredPieces(line, answers[line.itemId]) ?? 0,
      }))
      const { data } = await api.post(`/public/invoice-count/${token}/submit`, { lines: payload })
      return (data as { data: { hasDifference: boolean; differenceCount: number } }).data
    },
    onSuccess: (data) => {
      setSubmitError(null)
      setDone(data)
      void queryClient.invalidateQueries({ queryKey: ["public-invoice-count", token] })
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "تعذر إرسال الجرد. تأكد من الاتصال وحاول مرة أخرى."
      setSubmitError(message)
    },
  })

  function setAnswer(itemId: string, next: Partial<Answer>) {
    setAnswers((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? EMPTY), ...next } }))
  }

  if (linkQ.isLoading) return <CenteredNote icon={<Loader2 className="h-8 w-8 animate-spin" />} title="جاري فتح الفاتورة..." />
  if (linkQ.isError || !view) {
    return <CenteredNote tone="error" icon={<X className="h-8 w-8" />} title="رابط غير صالح" body="تأكد من الرابط أو اطلب من المحل رابطاً جديداً." />
  }
  if (done) {
    return (
      <CenteredNote
        tone="success"
        icon={<CheckCircle2 className="h-10 w-10" />}
        title={done.hasDifference ? "تم إرسال الجرد" : "تم إرسال الجرد — كل شيء مطابق"}
        body={
          done.hasDifference
            ? `سجّلنا فرقاً في ${done.differenceCount} مادة وأبلغنا المحل. شكراً لك.`
            : "شكراً لك. لا حاجة لأي إجراء آخر."
        }
      />
    )
  }
  if (blocked) {
    return <CenteredNote tone="warning" icon={<AlertTriangle className="h-8 w-8" />} title="لا يمكن الجرد الآن" body={blocked.message} />
  }

  const { invoice, store } = view
  const accent = designAccent(store.invoiceDesign)
  const currency = store.currency || "د.ع"

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100 pb-32 print:bg-white">
      {editingBy && <EditingOverlay name={editingBy} />}

      <div className="mx-auto max-w-4xl space-y-2 p-2 sm:p-4">
        {/* ── Invoice header, in the shop's own colours ── */}
        <header className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="h-2" style={{ background: accent }} />
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
            <div className="flex items-start gap-2">
              {store.storeLogo ? (
                <img src={store.storeLogo} alt="" className="h-11 w-11 rounded-lg object-contain" />
              ) : null}
              <div className="leading-tight">
                <h1 className="text-lg font-extrabold sm:text-xl" style={{ color: accent }}>
                  {store.storeName || "الفاتورة"}
                </h1>
                {store.storePhone && <p className="text-[13px] text-slate-500">{store.storePhone}</p>}
                {store.storeAddress && <p className="text-[13px] text-slate-500">{store.storeAddress}</p>}
              </div>
            </div>
            <div className="text-left leading-tight">
              <p className="text-base font-bold text-slate-900">فاتورة رقم {invoice.invoiceNumber}</p>
              <p className="text-[13px] text-slate-500">
                {invoice.date} · الدفع: <span className="font-bold" style={{ color: accent }}>{paymentLabel(invoice.paymentType)}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2 sm:px-4">
            <p className="text-[15px]">
              <span className="text-slate-400">الزبون: </span>
              <span className="font-extrabold text-slate-900">{invoice.customerName}</span>
            </p>
            <button
              type="button"
              onClick={() => setShowDesigned((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-4 w-4" />
              {showDesigned ? "إخفاء الفاتورة الأصلية" : "شوف الفاتورة الأصلية"}
            </button>
          </div>
        </header>

        {showDesigned && <DesignedInvoiceFrame view={view} />}

        {/* ── Instructions — one compact strip, not a paragraph ── */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[15px] leading-snug text-amber-900">
          <span className="font-extrabold">
            {view.audience === "WORKER" ? "جرد الفاتورة قبل خروجها من المحل" : "اجرد المواد التي وصلتك"}
          </span>
          {" — "}
          اضغط <span className="font-bold">«الكل»</span> إذا وصلت كاملة، أو اكتب العدد الواصل.
          مادة ما وصلتك اكتب <span className="font-bold">صفر</span>، لا تتركها فارغة.
        </div>

        {/* ── Lines ── */}
        <div className="space-y-1.5">
          {lines.map((line, index) => (
            <LineRow
              key={line.itemId}
              index={index + 1}
              line={line}
              answer={answers[line.itemId] ?? EMPTY}
              currency={currency}
              accent={accent}
              onChange={(next) => setAnswer(line.itemId, next)}
            />
          ))}
        </div>

        {/* ── Totals, read-only ── */}
        <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-sm font-bold text-slate-400">مجاميع الفاتورة كما هي الآن</h2>
          <dl className="space-y-1.5 text-sm">
            <Row label="مجموع الأصناف" value={`${fmt(invoice.subtotal)} ${currency}`} />
            {invoice.discount > 0 && <Row label="الخصم" value={`${fmt(invoice.discount)} ${currency}`} />}
            {invoice.tax > 0 && <Row label="الضريبة" value={`${fmt(invoice.tax)} ${currency}`} />}
            <Row label="إجمالي الفاتورة" value={`${fmt(invoice.totalAmount)} ${currency}`} bold />
            <Row label="المدفوع" value={`${fmt(invoice.paidAmount)} ${currency}`} className="text-teal-600" />
            <Row label="المتبقي" value={`${fmt(invoice.remainingAmount)} ${currency}`} className="text-rose-600" />
          </dl>
        </section>

        {submitError && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{submitError}</p>
        )}
      </div>

      {/* ── Sticky submit bar ── */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${((lines.length - remaining) / Math.max(1, lines.length)) * 100}%`, background: accent }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {remaining === 0 ? "جردت كل المواد" : `بقيت ${remaining} من ${lines.length} مادة`}
            </p>
          </div>
          <button
            type="button"
            disabled={remaining > 0 || submitMutation.isPending || !!editingBy}
            onClick={() => submitMutation.mutate()}
            className={cn(
              "w-full shrink-0 whitespace-nowrap rounded-xl px-6 py-3 text-base font-extrabold text-white",
              "transition disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto",
            )}
            style={{ background: accent }}
          >
            {submitMutation.isPending ? "جاري الإرسال..." : "إرسال الجرد"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Row({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn("tabular-nums", bold ? "text-base font-extrabold text-slate-900" : "font-semibold text-slate-700", className)}>
        {value}
      </dd>
    </div>
  )
}

/**
 * One invoice line, kept to two tight rows: everything the counter has to read
 * on the first, everything they have to touch on the second. The figures are
 * deliberately large — this is read on a phone in a warehouse — while the
 * chrome around them is squeezed so a six-line invoice fits on one screen.
 */
function LineRow({
  index, line, answer, currency, accent, onChange,
}: {
  index: number
  line: CountLine
  answer: Answer
  currency: string
  accent: string
  onChange: (next: Partial<Answer>) => void
}) {
  const counted = answeredPieces(line, answer)
  const difference = counted === null ? null : counted - line.expectedPieces
  const hasCartons = line.pcsPerCarton > 1
  const inputClass =
    "w-20 rounded-lg border-2 border-slate-300 bg-white px-2 py-1 text-center text-lg font-extrabold tabular-nums " +
    "focus:border-slate-600 focus:outline-none"

  return (
    <article
      className={cn(
        "rounded-xl border-2 bg-white px-2.5 py-2 shadow-sm",
        counted === null
          ? "border-slate-200"
          : difference === 0
            ? "border-emerald-400"
            : "border-amber-400",
      )}
    >
      {/* ── What it is ── */}
      <div className="flex items-baseline gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-extrabold text-white"
          style={{ background: accent }}
        >
          {index}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[17px] font-extrabold leading-tight text-slate-900" title={line.productName}>
          {line.productName}
        </h3>
        <span className="shrink-0 text-[15px] font-bold tabular-nums text-slate-900">
          {fmt(line.totalPrice)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pr-8 text-[14px] leading-tight">
        {line.itemNumber && (
          <span
            className="rounded px-1.5 py-0.5 font-extrabold tabular-nums"
            style={{ background: `${accent}18`, color: accent }}
          >
            {line.itemNumber}
          </span>
        )}
        <span className="font-bold text-slate-700">
          {line.quantity} {line.unitLabel}
        </span>
        <span className="text-slate-500">
          × {fmt(line.unitPrice)} {currency}
        </span>
        {hasCartons && <span className="text-slate-500">• {line.pcsPerCarton} ق/ك</span>}
        <span className="font-extrabold text-slate-900">
          المُرسل: {fmt(line.expectedPieces)} قطعة
        </span>
      </div>

      {/* ── What they do about it ── */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200 pt-1.5">
        <button
          type="button"
          onClick={() => onChange(answer.full ? { ...EMPTY } : { full: true, cartons: "", pieces: "" })}
          className={cn(
            "flex items-center gap-1 rounded-lg px-3 py-1.5 text-[15px] font-extrabold transition",
            answer.full ? "bg-emerald-600 text-white" : "border-2 border-slate-300 bg-white text-slate-700",
          )}
        >
          <Check className="h-4 w-4" />
          الكل
        </button>

        {hasCartons && (
          <label className="flex items-center gap-1">
            <span className="text-[13px] font-bold text-slate-500">كرتون</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={answer.cartons}
              onChange={(e) => onChange({ cartons: e.target.value, full: false })}
              className={inputClass}
              placeholder="0"
            />
          </label>
        )}
        <label className="flex items-center gap-1">
          <span className="text-[13px] font-bold text-slate-500">قطعة</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={answer.pieces}
            onChange={(e) => onChange({ pieces: e.target.value, full: false })}
            className={inputClass}
            placeholder="0"
          />
        </label>

        <span className="mr-auto whitespace-nowrap text-[15px] font-extrabold">
          {counted === null ? (
            <span className="text-slate-400">لم تُجرد</span>
          ) : difference === 0 ? (
            <span className="text-emerald-600">✓ {fmt(counted)} — مطابق</span>
          ) : (
            <span className="text-amber-700">
              {fmt(counted)} — {difference! > 0 ? `زيادة ${fmt(difference!)}` : `نقص ${fmt(-difference!)}`}
            </span>
          )}
        </span>
      </div>
    </article>
  )
}

/** The shop's actual printed design, read-only, for comparison. */
function DesignedInvoiceFrame({ view }: { view: CountLinkView }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const html = useMemo(() => {
    const design = parseDesigns(view.store.invoiceDesign).a4
    const printInv: PrintInvoice = {
      number: view.invoice.invoiceNumber,
      date: view.invoice.date,
      customerName: view.invoice.customerName,
      customerPhone: view.invoice.customerPhone ?? "",
      lines: view.invoice.lines.map((line) => ({
        name: line.productName,
        unit: line.unitLabel,
        qty: line.quantity,
        price: line.unitPrice,
        notes: line.notes ?? "",
        itemNumber: line.itemNumber ?? undefined,
        pcsPerCarton: line.pcsPerCarton,
      })),
      notes: view.invoice.notes ?? "",
      subtotal: view.invoice.subtotal,
      discount: view.invoice.discount,
      tax: view.invoice.tax,
      total: view.invoice.totalAmount,
      paid: view.invoice.paidAmount,
      remaining: view.invoice.remainingAmount,
      previousBalance: view.invoice.previousBalance,
      finalBalance: view.invoice.finalBalance,
      paymentType: paymentLabel(view.invoice.paymentType),
      invoiceType: view.invoice.type as "SALE" | "PURCHASE" | "SALES_RETURN",
    }
    return renderDesignHTML(design, printInv, {
      storeName: view.store.storeName,
      storeLogo: view.store.storeLogo ?? "",
      storePhone: view.store.storePhone ?? "",
      storeAddress: view.store.storeAddress ?? "",
      currency: view.store.currency,
    })
  }, [view])

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <iframe ref={frameRef} srcDoc={html} title="الفاتورة الأصلية" className="h-[70vh] w-full border-0" />
    </div>
  )
}

function EditingOverlay({ name }: { name: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-6 backdrop-blur-sm">
      <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <Lock className="mx-auto h-10 w-10 text-amber-500" />
        <h2 className="mt-3 text-lg font-extrabold text-slate-900">{name} يعدّل على الفاتورة الآن</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          انتظر لحظة — ستُفتح الصفحة تلقائياً حالما ينتهي، حتى لا تجرد فاتورة تتغيّر تحت يدك.
        </p>
        <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-slate-400" />
      </div>
    </div>
  )
}

function CenteredNote({
  icon, title, body, tone = "info",
}: {
  icon: React.ReactNode
  title: string
  body?: string
  tone?: "info" | "error" | "success" | "warning"
}) {
  const tones = {
    info: "text-slate-500",
    error: "text-rose-600",
    success: "text-emerald-600",
    warning: "text-amber-600",
  } as const
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className={cn("mx-auto flex justify-center", tones[tone])}>{icon}</div>
        <h1 className="mt-4 text-lg font-extrabold text-slate-900">{title}</h1>
        {body && <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>}
      </div>
    </div>
  )
}

/** The accent the shop picked in the invoice designer, so the page is theirs. */
function designAccent(invoiceDesign: string | null): string {
  const items = parseDesigns(invoiceDesign).a4.elements.find((el) => el.type === "items")
  const accent = items?.accent
  return accent && /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : "#4f46e5"
}
