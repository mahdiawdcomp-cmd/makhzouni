import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Document, Page, PDFDownloadLink, Text, View } from "@react-pdf/renderer"
import { ArrowRight, Copy, Link2, MessageCircle, Pencil } from "lucide-react"
import { createCustomerPortalLink } from "../api/endpoints"
import { fmt } from "../utils/fmt"
import { useCustomers, useCustomerDetails, useUpdateCustomer } from "../hooks/useCustomers"
import { useSettings } from "../hooks/useSettings"
import { fillTemplate, normalizePhone } from "../utils/whatsapp"
import { sendWhatsAppMessage } from "../api/endpoints"
import type { Customer, CustomerPayload, CustomerTransaction, ReceiptPayload } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { Label } from "../components/ui/label"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

const DEFAULT_STATEMENT_TEMPLATE =
  "كشف حساب {{customerName}} حتى {{date}}\nالرصيد الافتتاحي: {{openingBalance}} {{currency}}\nالرصيد الحالي: {{currentBalance}} {{currency}}\nمن {{storeName}}."

function money(value: number | undefined | null) { return fmt(value) }

function formatDateTime(value?: string | Date | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function translateLastType(type: string): string {
  const t = type.toUpperCase()
  if (t === "RECEIPT") return "سند قبض"
  if (t === "PAYMENT") return "سند دفع"
  if (t === "EXPENSE") return "سند مصاريف"
  if (t === "SALE") return "فاتورة بيع"
  if (t === "PURCHASE") return "فاتورة شراء"
  if (t === "SALES_RETURN") return "فاتورة مرتجع"
  if (t.includes("INVOICE")) return "فاتورة"
  if (t.includes("VOUCHER")) return "سند"
  return type
}

function translateRow(row: CustomerTransaction): string {
  const t = String(row.type ?? "").toUpperCase()
  if (row.status === "CANCELLED") return "فاتورة ملغاة"
  if (t === "RECEIPT") return "سند قبض"
  if (t === "PAYMENT") return "سند دفع"
  if (t === "EXPENSE") return "مصاريف"
  if (t === "SALE") return "فاتورة بيع"
  if (t === "PURCHASE") return "فاتورة شراء"
  if (t === "SALES_RETURN") return "فاتورة مرتجع"
  if (t.includes("INVOICE")) return Number(row.debit) > 0 ? "فاتورة بيع" : Number(row.credit) > 0 ? "فاتورة شراء" : "فاتورة"
  return translateLastType(row.type)
}

function lastActivityLink(last: { type?: string; id?: string } | undefined | null): string | null {
  if (!last?.id || !last?.type) return null
  const t = String(last.type).toUpperCase()
  if (t.includes("VOUCHER") || t === "RECEIPT" || t === "PAYMENT" || t === "EXPENSE") return `/vouchers/${last.id}`
  if (t.includes("INVOICE") || t === "SALE" || t === "PURCHASE" || t === "SALES_RETURN") return `/invoices/${last.id}`
  return null
}

function transactionLink(row: CustomerTransaction): string | null {
  if (!row.id || !row.type) return null
  const t = String(row.type).toUpperCase()
  if (t.includes("INVOICE") || t === "SALE" || t === "PURCHASE" || t === "SALES_RETURN") return `/invoices/${row.id}`
  if (t.includes("VOUCHER") || t === "RECEIPT" || t === "PAYMENT" || t === "EXPENSE") return `/vouchers/${row.id}`
  return null
}

function transactionTone(row: CustomerTransaction) {
  const type = String(row.type ?? "").toUpperCase()
  const status = String(row.status ?? "").toUpperCase()
  const isInvoice = type.includes("INVOICE") || type === "SALE" || type === "PURCHASE" || type === "SALES_RETURN"
  const isVoucher = type.includes("VOUCHER") || type === "RECEIPT" || type === "PAYMENT" || type === "EXPENSE"

  if (status === "CANCELLED") {
    return {
      row: "border-r-4 border-rose-500 bg-rose-50/80 hover:bg-rose-100/80",
      style: { backgroundColor: "#FFF1F2", borderRight: "4px solid #F43F5E" },
      label: "bg-rose-100 text-rose-700 border border-rose-200",
    }
  }
  if (isInvoice) {
    return {
      row: "border-r-4 border-blue-500 bg-blue-50/70 hover:bg-blue-100/70",
      style: { backgroundColor: "#EFF6FF", borderRight: "4px solid #3B82F6" },
      label: "bg-blue-100 text-blue-700 border border-blue-200",
    }
  }
  if (isVoucher) {
    return {
      row: "border-r-4 border-emerald-500 bg-emerald-50/70 hover:bg-emerald-100/70",
      style: { backgroundColor: "#ECFDF5", borderRight: "4px solid #10B981" },
      label: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    }
  }
  return {
    row: "border-r-4 border-slate-300 hover:bg-slate-50",
    style: { borderRight: "4px solid #CBD5E1" },
    label: "bg-slate-100 text-slate-700 border border-slate-200",
  }
}

function auditNote(row: CustomerTransaction) {
  if (!row.lastChangedAt) return "-"
  const action = row.lastAction === "DELETE"
    ? "إلغاء"
    : row.lastAction === "REACTIVATE"
      ? "إرجاع نشطة"
      : "تعديل"
  const user = row.lastChangedByName ? ` | ${row.lastChangedByName}` : ""
  return `${action}: ${formatDateTime(row.lastChangedAt)}${user}`
}

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<"statement" | "invoices" | "vouchers">("statement")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const details = useCustomerDetails(id)
  const updateMutation = useUpdateCustomer(id)
  const customer = details.customerQuery.data
  const transactions = details.transactionsQuery.data ?? []
  const invoices = details.invoicesQuery.data ?? []
  const vouchers = details.vouchersQuery.data ?? []
  const last = details.lastTransactionQuery.data
  const settings = useSettings().data
  const portalMutation = useMutation({
    mutationFn: () => createCustomerPortalLink(id!, 30),
  })

  const filteredTransactions = transactions.filter((row) => {
    const date = String(row.date).slice(0, 10)
    return (!from || date >= from) && (!to || date <= to)
  })

  const totalPurchases = invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount ?? 0), 0)
  const totalReceived = vouchers
    .filter((v) => v.type === "RECEIPT")
    .reduce((sum, v) => sum + Number(v.amount ?? 0), 0)

  async function sendStatement() {
    if (!customer) return
    if (!customer.phone) { toast({ title: "رقم الهاتف غير متوفر.", variant: "destructive" }); return }
    const tpl = settings?.statementTemplate || DEFAULT_STATEMENT_TEMPLATE
    const msg = fillTemplate(tpl, {
      customerName: customer.name,
      date: new Date().toISOString().slice(0, 10),
      openingBalance: money(customer.openingBalance),
      currentBalance: money(customer.currentBalance),
      currency: settings?.currency ?? "د.ع",
      storeName: settings?.storeName ?? "",
    })
    try {
      await sendWhatsAppMessage({ phone: normalizePhone(customer.phone), message: msg })
      toast({ title: "✓ تم إرسال الكشف عبر واتساب." })
    } catch {
      toast({ title: "✗ تعذر الإرسال. تحقق من إعدادات واتساب.", variant: "destructive" })
    }
  }

  async function createPortalLinkAndShare() {
    if (!customer) return
    const link = await portalMutation.mutateAsync()
    if (!link) return
    const fullUrl = `${window.location.origin}${link.urlPath}`
    await navigator.clipboard?.writeText(fullUrl)
    try {
      await sendWhatsAppMessage({ phone: normalizePhone(customer.phone), message: `رابط كشف حسابك:\n${fullUrl}` })
    } catch {
      toast({ title: "تم نسخ الرابط. تعذر الإرسال التلقائي." })
    }
  }

  const lastLink = lastActivityLink(last)
  const lastTimeStr = last?.date
    ? new Date(last.date).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })
    : customer?.lastTransactionAt
      ? new Date(customer.lastTransactionAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })
      : "-"

  if (!customer) return <div className="text-slate-500">جار تحميل الزبون...</div>

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="px-0" onClick={() => navigate(-1)}>
        <ArrowRight className="h-4 w-4" /> رجوع
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <p className="text-slate-500">{customer.phone}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 text-slate-600" /> تعديل البيانات
          </Button>
          <Button variant="outline" onClick={() => void sendStatement()} disabled={!customer.phone}>
            <MessageCircle className="h-4 w-4 text-emerald-600" /> إرسال كشف واتساب
          </Button>
          <Button variant="outline" onClick={createPortalLinkAndShare} disabled={portalMutation.isPending || !customer.phone}>
            {portalMutation.isPending ? <Copy className="h-4 w-4 animate-pulse" /> : <Link2 className="h-4 w-4 text-sky-600" />}
            رابط العميل
          </Button>
          <Button onClick={() => setReceiptOpen(true)}>سند قبض</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Summary title="الرصيد السابق" value={customer.openingBalance} />
        <Summary title="إجمالي المدفوع" value={totalReceived} />
        <Summary title="الرصيد النهائي" value={customer.currentBalance} danger={customer.currentBalance > 0} />
        <Summary title="إجمالي المشتريات" value={totalPurchases} />
      </div>

      {/* Last activity card — clickable */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div>
            <div className="text-slate-500">آخر حركة</div>
            <div className="font-medium">
              {last?.type ? translateLastType(last.type) : "—"} {last?.referenceNumber ? `(${last.referenceNumber})` : ""}
            </div>
            <div className="text-xs text-slate-500">{lastTimeStr}</div>
          </div>
          {lastLink ? (
            <Button asChild variant="outline"><Link to={lastLink}>فتح الحركة</Link></Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex gap-2">
            <Button variant={tab === "statement" ? "default" : "outline"} onClick={() => setTab("statement")}>كشف الحساب</Button>
            <Button variant={tab === "invoices" ? "default" : "outline"} onClick={() => setTab("invoices")}>الفواتير</Button>
            <Button variant={tab === "vouchers" ? "default" : "outline"} onClick={() => setTab("vouchers")}>السندات</Button>
          </div>
        </CardHeader>
        <CardContent>
          {tab === "statement" ? <StatementTab customer={customer} rows={filteredTransactions} from={from} to={to} setFrom={setFrom} setTo={setTo} /> : null}
          {tab === "invoices" ? (
            <Table>
              <THead><TR><TH>الرقم</TH><TH>النوع</TH><TH>التاريخ</TH><TH>الإجمالي</TH><TH>الحالة</TH><TH>فتح</TH></TR></THead>
              <TBody>{invoices.map((invoice) => (
                <TR key={invoice.id}>
                  <TD>{invoice.invoiceNumber}</TD>
                  <TD>{invoice.type === "PURCHASE" ? "شراء" : "بيع"}</TD>
                  <TD>{invoice.date?.slice(0, 10)}</TD>
                  <TD>{invoice.totalAmount}</TD>
                  <TD>{invoice.status}</TD>
                  <TD><Button asChild variant="outline"><Link to={`/invoices/${invoice.id}`}>فتح</Link></Button></TD>
                </TR>
              ))}</TBody>
            </Table>
          ) : null}
          {tab === "vouchers" ? (
            <Table>
              <THead><TR><TH>الرقم</TH><TH>التاريخ</TH><TH>النوع</TH><TH>المبلغ</TH><TH>ملاحظات</TH><TH>فتح</TH></TR></THead>
              <TBody>{vouchers.map((voucher) => (
                <TR key={voucher.id}>
                  <TD>{voucher.voucherNumber}</TD>
                  <TD>{voucher.date?.slice(0, 10)}</TD>
                  <TD>{translateLastType(voucher.type)}</TD>
                  <TD>{voucher.amount}</TD>
                  <TD>{voucher.notes ?? "-"}</TD>
                  <TD><Button asChild variant="outline"><Link to={`/vouchers/${voucher.id}`}>فتح</Link></Button></TD>
                </TR>
              ))}</TBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <ReceiptModal open={receiptOpen} onOpenChange={setReceiptOpen} selectedCustomer={customer} />
      <EditCustomerModal
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
        onSave={(payload) =>
          updateMutation.mutate(payload, { onSuccess: () => setEditOpen(false) })
        }
        isPending={updateMutation.isPending}
        isError={updateMutation.isError}
      />
    </div>
  )
}

function Summary({ title, value, danger = false }: { title: string; value: string | number; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-slate-500">{title}</div>
        <div className={danger ? "text-2xl font-bold text-red-600" : "text-2xl font-bold"}>{value}</div>
      </CardContent>
    </Card>
  )
}

function StatementTab({
  customer,
  rows,
  from,
  to,
  setFrom,
  setTo,
}: {
  customer: Customer
  rows: CustomerTransaction[]
  from: string
  to: string
  setFrom: (value: string) => void
  setTo: (value: string) => void
}) {
  const csv = useMemo(() => {
    const fmtDate = (v: string | null | undefined) =>
      v ? new Date(v).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" }) : ""
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const header = [
      "التاريخ", "وقت الإدخال", "أنشأه", "النوع", "الرقم المرجعي",
      "مدين (على الزبون)", "دائن (للزبون)", "الرصيد", "آخر تعديل",
    ].map(q).join(",")
    const body = rows.map((row) => [
      fmtDate(row.date),
      fmtDate(row.createdAt),
      row.createdByName ?? "",
      translateRow(row),
      row.referenceNumber,
      row.debit ? Number(row.debit).toLocaleString("en-US") : "",
      row.credit ? Number(row.credit).toLocaleString("en-US") : "",
      Number(row.runningBalance).toLocaleString("en-US"),
      row.lastChangedAt ? fmtDate(row.lastChangedAt) : "",
    ].map(q).join(","))
    return "﻿" + [header, ...body].join("\n")
  }, [rows])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-44" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input className="w-44" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <Button variant="outline" asChild><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download={`${customer.name}-statement.csv`}>تصدير Excel</a></Button>
        <PDFDownloadLink document={<StatementPdf customer={customer} rows={rows} />} fileName={`${customer.name}-statement.pdf`}>
          <Button variant="outline">PDF</Button>
        </PDFDownloadLink>
      </div>
      <Table>
        <THead><TR><TH>التاريخ</TH><TH>النوع</TH><TH>على الزبون</TH><TH>بيه الزبون</TH><TH>الرصيد</TH><TH>فتح</TH></TR></THead>
        <TBody>{rows.map((row) => {
          const link = transactionLink(row)
          const tone = transactionTone(row)
          const label = translateRow(row)
          return (
            <TR key={`${row.id}-${row.referenceNumber}`} className={`${tone.row} ${link ? "cursor-pointer" : ""}`} style={tone.style}>
              <TD>
                <div>{formatDateTime(row.date)}</div>
                <div className="text-[11px] text-slate-500">إدخال: {formatDateTime(row.createdAt)}</div>
              </TD>
              <TD>
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone.label}`}>{label}</span>
                <div className="mt-1 text-[11px] text-slate-500">رقم: {row.referenceNumber}</div>
                <div className="text-[11px] text-slate-500">أنشأه: {row.createdByName ?? "-"}</div>
                <div className="text-[11px] text-slate-500">آخر تغيير: {auditNote(row)}</div>
              </TD>
              <TD className={row.debit ? "font-semibold text-rose-700" : "text-slate-400"}>{row.debit ? money(row.debit) : "—"}</TD>
              <TD className={row.credit ? "font-semibold text-emerald-700" : "text-slate-400"}>{row.credit ? money(row.credit) : "—"}</TD>
              <TD className="font-bold">{money(row.runningBalance)}</TD>
              <TD>{link ? <Button asChild variant="outline"><Link to={link}>فتح</Link></Button> : null}</TD>
            </TR>
          )
        })}</TBody>
      </Table>
    </div>
  )
}

function ReceiptModal({
  open,
  onOpenChange,
  selectedCustomer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedCustomer: Customer
}) {
  const { customersQuery, receiptMutation } = useCustomers()
  const [query, setQuery] = useState(selectedCustomer.name)
  const [customer, setCustomer] = useState<Customer>(selectedCustomer)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState("")
  const suggestions = (customersQuery.data ?? []).filter((item) => item.name.includes(query) || item.phone.includes(query)).slice(0, 6)

  function submit(event: FormEvent) {
    event.preventDefault()
    const payload: ReceiptPayload = { customerId: customer.id, amount: Number(amount), type: "RECEIPT", date, notes }
    receiptMutation.mutate(payload, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <ModalForm open={open} onOpenChange={onOpenChange} title="سند قبض">
      <form className="space-y-3" onSubmit={submit}>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اختر الزبون" />
        {suggestions.map((item) => (
          <button key={item.id} type="button" className="block w-full rounded-md border p-2 text-right text-sm" onClick={() => { setCustomer(item); setQuery(item.name) }}>
            {item.name} - الرصيد: {item.currentBalance}
          </button>
        ))}
        <div className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-900">الرصيد الحالي: {customer.currentBalance}</div>
        <Input required type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="المبلغ" />
        <Input required type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات" />
        <Button className="w-full" type="submit">حفظ السند</Button>
      </form>
    </ModalForm>
  )
}

function EditCustomerModal({
  open,
  onOpenChange,
  customer,
  onSave,
  isPending,
  isError,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer
  onSave: (payload: Partial<CustomerPayload>) => void
  isPending: boolean
  isError: boolean
}) {
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.phone,
    address: customer.address ?? "",
    notes: customer.notes ?? "",
    isSupplier: customer.isSupplier ?? false,
    creditLimit: customer.creditLimit != null ? String(customer.creditLimit) : "",
  })

  // Reset form to latest customer data every time the modal opens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        name: customer.name,
        phone: customer.phone,
        address: customer.address ?? "",
        notes: customer.notes ?? "",
        isSupplier: customer.isSupplier ?? false,
        creditLimit: customer.creditLimit != null ? String(customer.creditLimit) : "",
      })
    }
  }, [open, customer])

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) return
    onSave({
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim() || undefined,
      notes: form.notes.trim() || undefined,
      isSupplier: form.isSupplier,
      creditLimit: form.creditLimit !== "" ? Number(form.creditLimit) : null,
    })
  }

  return (
    <ModalForm open={open} onOpenChange={onOpenChange} title="تعديل بيانات الزبون">
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1">
          <Label>الاسم *</Label>
          <Input
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="اسم الزبون"
          />
        </div>

        <div className="space-y-1">
          <Label>رقم الهاتف *</Label>
          <Input
            required
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="رقم الهاتف"
            inputMode="tel"
            dir="ltr"
          />
        </div>

        <div className="space-y-1">
          <Label>العنوان</Label>
          <Input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="العنوان (اختياري)"
          />
        </div>

        <div className="space-y-1">
          <Label>ملاحظات</Label>
          <Input
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="ملاحظات (اختيارية)"
          />
        </div>

        <div className="space-y-1">
          <Label>حد الائتمان (أقصى دين مسموح) — اتركه فارغاً لبلا حد</Label>
          <Input
            type="number"
            min={0}
            value={form.creditLimit}
            onChange={(e) => set("creditLimit", e.target.value)}
            placeholder="مثال: 500000"
            dir="ltr"
          />
        </div>

        <div className="space-y-1">
          <Label>النوع</Label>
          <div className="flex gap-2">
            {([
              { label: "زبون", value: false, desc: "يظهر في قائمة الزبائن" },
              { label: "مورد", value: true, desc: "يظهر في قائمة الموردين" },
            ] as const).map(({ label, value, desc }) => (
              <label key={label} className={`flex flex-1 cursor-pointer flex-col gap-0.5 rounded-lg border-2 p-3 transition ${form.isSupplier === value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="customerType" checked={form.isSupplier === value} onChange={() => set("isSupplier", value)} className="accent-indigo-600" />
                  <span className="font-semibold text-sm">{label}</span>
                </div>
                <span className="text-xs text-slate-500 mr-5">{desc}</span>
              </label>
            ))}
          </div>
        </div>

        {isError && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            تعذر حفظ التعديلات. تأكد من المعلومات وحاول مرة أخرى.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="submit" className="flex-1" disabled={isPending}>
            {isPending ? "جاري الحفظ..." : "حفظ التعديلات"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
        </div>
      </form>
    </ModalForm>
  )
}

function StatementPdf({ customer, rows }: { customer: Customer; rows: CustomerTransaction[] }) {
  return (
    <Document>
      <Page size="A4">
        <View style={{ padding: 24 }}>
          <Text>كشف حساب: {customer.name}</Text>
          {rows.map((row) => (
            <Text key={row.id}>{String(row.date).slice(0, 10)} - {row.type} - {row.runningBalance}</Text>
          ))}
        </View>
      </Page>
    </Document>
  )
}
