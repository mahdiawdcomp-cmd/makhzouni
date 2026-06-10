import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileDown,
  MessageCircle,
  Pencil,
  Printer,
  Plus,
  RefreshCw,
  ShoppingCart,
  Receipt as ReceiptIcon,
  Trash2,
} from "lucide-react"
import { cancelInvoice, getInvoiceAuditTrail, reactivateInvoice, sendWhatsAppMessage, updateInvoice } from "../api/endpoints"
import { fmt } from "../utils/fmt"
import { useInvoice, useInvoices } from "../hooks/useInvoices"
import { useProducts } from "../hooks/useProducts"
import { useSettings } from "../hooks/useSettings"
import { fillTemplate, normalizePhone } from "../utils/whatsapp"
import type { Product } from "../types/api"
import { Button } from "../components/ui/button"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

function money(v: number | undefined) { return fmt(v) }

function unitLabel(unit: string) {
  if (unit === "CARTON") return "كرتونة"
  if (unit === "DOZEN") return "درزن"
  return "قطعة"
}

const DEFAULT_INVOICE_TEMPLATE =
  "مرحباً {{customerName}}،\nفاتورتك رقم {{invoiceNumber}} بتاريخ {{date}}\nالمجموع: {{total}} {{currency}}\nالمدفوع: {{paid}} {{currency}}\nالباقي: {{remaining}} {{currency}}\nالحساب النهائي: {{finalBalance}} {{currency}}\nشكراً لتعاملكم مع {{storeName}}."

interface EditItem {
  productId: string; productName: string
  unit: "PIECE" | "DOZEN" | "CARTON"; quantity: number; unitPrice: number
}

export function InvoiceDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invoiceQuery = useInvoice(id)
  const invoice = invoiceQuery.data
  const auditQuery = useQuery({
    queryKey: ["invoices", id, "audit-trail"],
    queryFn: () => getInvoiceAuditTrail(id!),
    enabled: Boolean(id),
  })
  const settingsQuery = useSettings()
  const settings = settingsQuery.data
  const { productsQuery } = useProducts()
  const allProducts = productsQuery.data ?? []

  // Navigation within same type
  const listQuery = useInvoices()
  const list = listQuery.data ?? []
  const sorted = useMemo(() => {
    const type = invoice?.type ?? "SALE"
    return [...list].filter((r) => (r.type ?? "SALE") === type).sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber))
  }, [list, invoice?.type])
  const idx = sorted.findIndex((r) => r.id === id)
  const firstId = sorted[0]?.id; const lastId = sorted[sorted.length - 1]?.id
  const prevId = idx > 0 ? sorted[idx - 1].id : null
  const nextId = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].id : null
  const goto = (t: string | null | undefined) => { if (t && t !== id) navigate(`/invoices/${t}`) }

  // WhatsApp preview
  const [waPreview, setWaPreview] = useState(false)
  const [waMessage, setWaMessage] = useState("")
  const [waSending, setWaSending] = useState(false)
  function openWaPreview() {
    if (!invoice) return
    const tpl = settings?.invoiceTemplate || DEFAULT_INVOICE_TEMPLATE
    setWaMessage(fillTemplate(tpl, {
      customerName: invoice.customer?.name ?? "",
      invoiceNumber: invoice.invoiceNumber,
      date: String(invoice.date).slice(0, 10),
      total: money(invoice.totalAmount),
      paid: money(invoice.paidAmount),
      remaining: money(invoice.remainingAmount),
      finalBalance: money(invoice.finalBalance),
      currency: settings?.currency ?? "د.ع",
      storeName: settings?.storeName ?? "",
    }))
    setWaPreview(true)
  }
  async function sendWaMessage() {
    const phone = invoice?.customer?.phone
    if (!phone) { window.alert("رقم الهاتف غير متوفر."); return }
    setWaSending(true)
    try {
      await sendWhatsAppMessage({ phone: normalizePhone(phone), message: waMessage })
      setWaPreview(false)
      window.alert("✓ تم إرسال الفاتورة عبر واتساب.")
    } catch {
      window.alert("✗ تعذر الإرسال. تحقق من إعدادات واتساب.")
    } finally {
      setWaSending(false)
    }
  }

  const cancelMutation = useMutation({
    mutationFn: () => cancelInvoice(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id, "audit-trail"] })
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateInvoice(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id, "audit-trail"] })
    },
  })

  function fmtNumInput(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, "")
    if (!digits) return ""
    return Number(digits).toLocaleString("en-US")
  }

  // Full edit dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editDiscount, setEditDiscount] = useState("")
  const [editTax, setEditTax] = useState("")
  const [editPaid, setEditPaid] = useState("")
  const [editItems, setEditItems] = useState<EditItem[]>([])
  const [editProductSearch, setEditProductSearch] = useState("")
  const [editProductOpen, setEditProductOpen] = useState(false)

  const filteredEditProducts = useMemo(
    () => allProducts.filter((p) => {
      const q = editProductSearch.toLowerCase()
      return !q || p.name.toLowerCase().includes(q) || p.itemNumber.toLowerCase().includes(q)
    }).slice(0, 12), [allProducts, editProductSearch])

  function openEdit() {
    if (!invoice) return
    setEditDiscount(String(invoice.discount ?? 0))
    setEditTax("0")
    setEditPaid(Number(invoice.paidAmount ?? 0).toLocaleString("en-US"))
    setEditItems((invoice.items ?? []).map((it) => ({
      productId: it.productId, productName: it.productName ?? it.productId,
      unit: (it.unit ?? "PIECE") as "PIECE" | "DOZEN" | "CARTON",
      quantity: it.quantity, unitPrice: Number(it.unitPrice),
    })))
    setEditOpen(true)
  }

  function addEditProduct(p: Product) {
    setEditItems((prev) => [...prev, {
      productId: p.id, productName: p.name, unit: "PIECE", quantity: 1,
      unitPrice: (invoice?.type === "PURCHASE" ? p.purchasePrice : p.salePrice) ?? 0,
    }])
    setEditProductOpen(false); setEditProductSearch("")
  }

  const editSubtotal = editItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
  const editTotal = editSubtotal - Number(editDiscount) + Number(editTax)

  const editMutation = useMutation({
    mutationFn: () => updateInvoice(id!, {
      type: invoice?.type, customerId: invoice?.customerId ?? "",
      discount: Number(editDiscount), tax: 0, paidAmount: Number(editPaid.replace(/,/g, "")),
      paymentType: editTotal - Number(editPaid.replace(/,/g, "")) <= 0 ? "CASH" : Number(editPaid.replace(/,/g, "")) > 0 ? "PARTIAL" : "CREDIT",
      items: editItems.map((it) => ({ productId: it.productId, unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice })),
    }),
    onSuccess: () => {
      setEditOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id, "audit-trail"] })
    },
  })

  if (invoiceQuery.isLoading) return <div className="text-sm text-slate-500">جاري تحميل الفاتورة...</div>
  if (!invoice) return <div className="text-sm text-slate-500">الفاتورة غير موجودة.</div>

  const isPurchase = invoice.type === "PURCHASE"
  const isReturn = invoice.type === "SALES_RETURN"
  const accentColor = isPurchase ? "#f59e0b" : isReturn ? "#dc2626" : "#4F46E5"
  const customerLabel = isPurchase ? "المورد" : "الزبون / العميل"
  const typeLabel = isPurchase ? "فاتورة شراء" : isReturn ? "فاتورة مرتجع مبيعات" : "فاتورة مبيعات"
  const currency = settings?.currency ?? "د.ع"

  const lastEditNote = invoice.updatedAt && invoice.updatedAt !== invoice.createdAt
    ? `آخر تعديل: ${new Date(invoice.updatedAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}${invoice.creator ? ` | ${invoice.creator.name}` : ""}`
    : null

  return (
    <div className="space-y-3 max-w-4xl mx-auto">
      {/* Toolbar — hidden on print */}
      <div className="print:hidden flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="px-0" onClick={() => history.length > 1 ? navigate(-1) : navigate("/invoices")}>
          <ArrowRight className="h-4 w-4" /> رجوع
        </Button>
        {/* Navigation */}
        <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
          <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => goto(firstId)} disabled={!firstId || id === firstId} title="الأولى"><ChevronsRight className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => goto(prevId)} disabled={!prevId} title="السابقة"><ChevronRight className="h-3.5 w-3.5" /></Button>
          <span className="px-2 text-xs text-slate-500">{idx >= 0 ? `${idx + 1}/${sorted.length}` : "-"}</span>
          <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => goto(nextId)} disabled={!nextId} title="التالية"><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => goto(lastId)} disabled={!lastId || id === lastId} title="الأخيرة"><ChevronsLeft className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="mr-auto flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={openWaPreview}><MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> واتساب</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> طباعة</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><FileDown className="h-3.5 w-3.5" /> PDF / طباعة</Button>
          {invoice.status === "ACTIVE" ? (
            <>
              <Button variant="outline" size="sm" onClick={openEdit}><Pencil className="h-3.5 w-3.5" /> تعديل</Button>
              <Button variant="destructive" size="sm" onClick={() => { if (window.confirm("هل تريد إلغاء هذه الفاتورة؟")) cancelMutation.mutate() }} disabled={cancelMutation.isPending}>
                <Ban className="h-3.5 w-3.5" /> إلغاء
              </Button>
            </>
          ) : (
            <>
              <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">ملغاة</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { if (window.confirm("هل تريد إرجاع الفاتورة نشطة؟ سيتم إرجاع تأثيرها على الحساب والمخزون.")) reactivateMutation.mutate() }}
                disabled={reactivateMutation.isPending}
              >
                <RefreshCw className="h-3.5 w-3.5" /> إرجاع نشطة
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          PRINTABLE INVOICE — matches the HTML design exactly   */}
      <div
        className="rounded-xl bg-white shadow-md overflow-hidden"
        style={{ borderTop: `8px solid ${accentColor}` }}
      >
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-8 py-6">
          <div>
            <div className="flex items-center gap-2">
              {isPurchase ? <ShoppingCart className="h-7 w-7" style={{ color: accentColor }} /> : isReturn ? <RefreshCw className="h-7 w-7" style={{ color: accentColor }} /> : <ReceiptIcon className="h-7 w-7" style={{ color: accentColor }} />}
              <h1 className="text-2xl font-extrabold" style={{ color: accentColor }}>{typeLabel}</h1>
            </div>
            <p className="mt-1.5 text-base font-bold text-gray-800">{settings?.storeName ?? "مخزوني"}</p>
            {settings?.storePhone ? <p className="text-sm text-gray-600 mt-0.5">الهاتف: <span className="font-bold">{settings.storePhone}</span></p> : null}
            {settings?.storeAddress ? <p className="text-sm text-gray-600 mt-0.5">{settings.storeAddress}</p> : null}
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
            <p className="text-gray-600">رقم الفاتورة: <span className="font-bold text-gray-800">{invoice.invoiceNumber}</span></p>
            <p className="text-gray-600 mt-1">التاريخ: <span className="font-bold text-gray-800">{String(invoice.date).slice(0, 10)}</span></p>
            <p className="text-gray-600 mt-1">نوع الدفع: <span className="font-bold text-gray-800">{invoice.paymentType}</span></p>
            <p className={`mt-1 text-xs font-semibold ${invoice.status === "ACTIVE" ? "text-emerald-700" : "text-rose-700"}`}>
              {invoice.status === "ACTIVE" ? "✓ نشطة" : "✗ ملغاة"}
            </p>
            {lastEditNote ? <p className="mt-1 text-xs text-gray-400">{lastEditNote}</p> : null}
          </div>
        </div>

        {/* Customer info */}
        <div className="mx-8 mt-5 rounded-lg border border-gray-100 bg-gray-50 px-5 py-4">
          <p className="text-xs font-bold text-gray-500 mb-1">{customerLabel}:</p>
          <h2 className="text-xl font-bold text-gray-800">{invoice.customer?.name ?? "—"}</h2>
          {invoice.customer?.phone ? <p className="text-sm text-gray-600 mt-0.5">هاتف: {invoice.customer.phone}</p> : null}
        </div>

        {/* Items table */}
        <div className="px-8 mt-5">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="text-white text-sm" style={{ backgroundColor: accentColor }}>
                <th className="rounded-r-lg py-3 px-4">#</th>
                <th className="py-3 px-4 text-right">اسم الصنف</th>
                <th className="py-3 px-4 text-center">الوحدة</th>
                <th className="py-3 px-4 text-center">الكمية</th>
                <th className="py-3 px-4 text-center">سعر الوحدة</th>
                <th className="rounded-l-lg py-3 px-4 text-left">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.items ?? []).map((item, i) => (
                <tr key={item.id ?? i} className="border-b border-gray-100 hover:bg-gray-50 transition">
                  <td className="py-3 px-4 text-gray-500 font-bold">{i + 1}</td>
                  <td className="py-3 px-4">
                    <p className="font-bold text-gray-800">{item.productName ?? item.productId}</p>
                    <p className="text-xs text-gray-500">{unitLabel(item.unit)}</p>
                  </td>
                  <td className="py-3 px-4 text-center">{unitLabel(item.unit)}</td>
                  <td className="py-3 px-4 text-center font-bold">{fmt(item.quantity)}</td>
                  <td className="py-3 px-4 text-center">{money(item.unitPrice)} {currency}</td>
                  <td className="py-3 px-4 text-left font-bold" style={{ color: accentColor }}>{money(item.totalPrice)} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Two-column summary — matches HTML design */}
        <div className="mx-8 mt-6 mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Left: Invoice details */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-2">
            <h3 className="font-bold text-gray-800 border-b border-gray-200 pb-2 mb-3">تفاصيل الفاتورة الحالية</h3>
            <SummaryRow label="قيمة الفاتورة" value={`${money(invoice.subtotal)} ${currency}`} />
            {Number(invoice.discount) > 0 ? <SummaryRow label="الخصم" value={`${money(invoice.discount)} ${currency}`} /> : null}
            <SummaryRow label="الإجمالي" value={`${money(invoice.totalAmount)} ${currency}`} strong />
            <SummaryRow label="الواصل (المدفوع)" value={`${money(invoice.paidAmount)} ${currency}`} color="text-emerald-600" />
            <div className="flex items-center justify-between rounded-lg bg-gray-200 px-3 py-2 mt-1">
              <span className="font-bold text-lg">الباقي من الفاتورة:</span>
              <span className="font-extrabold text-xl text-rose-600">{money(invoice.remainingAmount)} {currency}</span>
            </div>
          </div>

          {/* Right: Full account */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 space-y-2">
            <h3 className="font-bold text-blue-900 border-b border-blue-200 pb-2 mb-3">كشف الحساب الكلي</h3>
            <SummaryRow label="الحساب السابق" value={`${money(invoice.previousBalance)} ${currency}`} />
            <SummaryRow label={isPurchase || isReturn ? "يطرح المتبقي" : "يضاف المتبقي"} value={`${money(invoice.remainingAmount)} ${currency}`} />
            <div className="flex items-center justify-between rounded-lg bg-blue-200 px-3 py-2 mt-1">
              <span className="font-bold text-blue-900 text-lg">الحساب النهائي:</span>
              <span className="font-extrabold text-xl text-blue-900">{money(invoice.finalBalance)} {currency}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mx-8 mb-6 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          شكراً لتعاملكم معنا! — {settings?.storeName ?? "مخزوني"}
          {settings?.storePhone ? ` — ${settings.storePhone}` : ""}
        </div>
      </div>
      {/* End printable section */}

      <div className="print:hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">تاريخ تعديلات الفاتورة</h2>
          <span className="text-xs text-slate-500">{auditQuery.data?.length ?? 0} حركة</span>
        </div>
        <div className="space-y-2">
          {(auditQuery.data ?? []).map((entry) => (
            <div key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-800">{entry.actionLabel}</div>
                <div className="text-xs text-slate-500">
                  {new Date(entry.createdAt).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" })}
                  {" | "}
                  {entry.user?.name ?? entry.user?.username ?? "-"}
                </div>
              </div>
              {entry.changes.length ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {entry.changes.map((change) => (
                    <div key={`${entry.id}-${change.field}`} className="rounded-md bg-white px-3 py-2 text-xs">
                      <div className="mb-1 font-semibold text-slate-600">{change.label}</div>
                      <div className="text-rose-600">قبل: {change.before}</div>
                      <div className="text-emerald-600">بعد: {change.after}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-1 text-xs text-slate-500">تم تسجيل الحركة بدون تفاصيل قابلة للعرض.</div>
              )}
            </div>
          ))}
          {!auditQuery.isLoading && (auditQuery.data ?? []).length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-400">
              لا توجد تعديلات مسجلة على هذه الفاتورة.
            </div>
          ) : null}
        </div>
      </div>

      {/* WhatsApp preview dialog */}
      <Dialog open={waPreview} onOpenChange={setWaPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>معاينة رسالة واتساب</DialogTitle></DialogHeader>
          <div className="rounded-xl bg-emerald-50 p-4 text-sm whitespace-pre-wrap">{waMessage}</div>
          <div className="flex gap-2">
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => void sendWaMessage()} disabled={waSending}>
              <MessageCircle className="h-4 w-4" /> {waSending ? "جاري الإرسال..." : "إرسال"}
            </Button>
            <Button variant="outline" onClick={() => setWaPreview(false)}>إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Full edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل الفاتورة {invoice.invoiceNumber}</DialogTitle>
            <p className="text-xs text-slate-500">التاريخ ورقم الفاتورة ثابتان.</p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">الأصناف</span>
              <Button size="sm" onClick={() => setEditProductOpen(true)}><Plus className="h-4 w-4" /> أضف</Button>
            </div>
            <Table>
              <THead><TR><TH>الاسم</TH><TH>الوحدة</TH><TH>العدد</TH><TH>السعر</TH><TH>الإجمالي</TH><TH>×</TH></TR></THead>
              <TBody>
                {editItems.map((it, i) => (
                  <TR key={i}>
                    <TD className="text-sm font-medium">{it.productName}</TD>
                    <TD>
                      <select className="h-8 rounded border bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950" value={it.unit}
                        onChange={(e) => setEditItems((p) => p.map((x, j) => j === i ? { ...x, unit: e.target.value as "PIECE" | "DOZEN" | "CARTON" } : x))}>
                        <option value="PIECE">قطعة</option><option value="DOZEN">درزن</option><option value="CARTON">كرتونة</option>
                      </select>
                    </TD>
                    <TD><Input type="number" className="w-20 h-8 text-sm" value={it.quantity} onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditItems((p) => p.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} /></TD>
                    <TD><Input type="number" className="w-24 h-8 text-sm" value={it.unitPrice} onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditItems((p) => p.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) } : x))} /></TD>
                    <TD><Input type="number" className="w-28 h-8 text-sm font-semibold" value={Math.round(it.quantity * it.unitPrice)}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const tot = Number(e.target.value); const qty = it.quantity || 1
                        setEditItems((p) => p.map((x, j) => j === i ? { ...x, unitPrice: Math.round(tot / qty * 1000) / 1000 } : x))
                      }} /></TD>
                    <TD><Button variant="ghost" size="sm" onClick={() => setEditItems((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button></TD>
                  </TR>
                ))}
                {editItems.length === 0 ? <TR><TD colSpan={6} className="py-4 text-center text-sm text-slate-400">لا يوجد أصناف</TD></TR> : null}
              </TBody>
            </Table>
            {editProductOpen ? (
              <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-900 dark:border-slate-700">
                <Input autoFocus placeholder="بحث بالاسم أو رقم الصنف" value={editProductSearch} onChange={(e) => setEditProductSearch(e.target.value)} className="mb-2" />
                <div className="max-h-48 overflow-auto">
                  {filteredEditProducts.map((p) => (
                    <button key={p.id} type="button" className="flex w-full justify-between rounded px-3 py-2 text-sm hover:bg-white dark:hover:bg-slate-800 text-right"
                      onClick={() => addEditProduct(p)}>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-slate-500">{p.itemNumber}</span>
                    </button>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-1" onClick={() => setEditProductOpen(false)}>إغلاق</Button>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">الخصم</label>
                <Input type="number" value={editDiscount} onFocus={(e) => e.target.select()} onChange={(e) => setEditDiscount(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">المبلغ المدفوع</label>
                <Input inputMode="numeric" dir="ltr" value={editPaid} onFocus={(e) => e.target.select()} onChange={(e) => setEditPaid(fmtNumInput(e.target.value))} />
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-sm flex justify-between font-bold text-base">
              <span>الإجمالي بعد التعديل</span><span>{fmt(editTotal)}</span>
            </div>
            {editTotal < 0 ? <div className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" /> الخصم أكبر من المجموع</div> : null}
            <Button className="w-full" onClick={() => editMutation.mutate()} disabled={editMutation.isPending || editItems.length === 0 || editTotal < 0}>
              {editMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : null} حفظ التعديلات
            </Button>
            {editMutation.isError ? <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{editMutation.error instanceof Error ? editMutation.error.message : "تعذر التعديل"}</div> : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryRow({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-600">{label}</span>
      <span className={`${strong ? "font-bold" : "font-medium"} ${color ?? ""}`}>{value}</span>
    </div>
  )
}
