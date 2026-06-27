import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowRight, Copy, Link2, MessageCircle, Pencil, Send, Trash2 } from "lucide-react"
import { CustomerStatementPdfButton } from "../components/CustomerStatementPdfButton"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { createCustomerPortalLink, toggleCustomerPortalLink, getCustomerRatings, deleteCustomer, recalculateCustomerBalance } from "../api/endpoints"
import { fmt } from "../utils/fmt"
import { useAuthStore } from "../store/authStore"
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
import { TagPicker } from "../components/ui/tag-picker"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { localDateStr, formatDate, formatDateTime } from "../utils/date"

const DEFAULT_STATEMENT_TEMPLATE =
  "كشف حساب {{customerName}} حتى {{date}}\nالرصيد الافتتاحي: {{openingBalance}} {{currency}}\nالرصيد الحالي: {{currentBalance}} {{currency}}\nمن {{storeName}}."

function money(value: number | undefined | null) { return fmt(value) }

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
  if (t === "INVOICE_PAYMENT") return "دفعة"
  if (t === "EXPENSE") return "مصاريف"
  if (t === "SALE") return "فاتورة بيع"
  if (t === "PURCHASE") return "فاتورة شراء"
  if (t === "SALES_RETURN") return "فاتورة مرتجع"
  if (t.includes("INVOICE")) return Number(row.debit) > 0 ? "فاتورة بيع" : Number(row.credit) > 0 ? "فاتورة شراء" : "فاتورة"
  return translateLastType(row.type)
}

// Merge INVOICE + INVOICE_PAYMENT rows for the same invoice into one row.
// The merged row shows: debit = invoice total, credit = amount paid on that invoice,
// runningBalance = balance after both (i.e. from the INVOICE_PAYMENT row).
function mergeStatementRows(rows: CustomerTransaction[]): CustomerTransaction[] {
  const payments = new Map<string, CustomerTransaction>()
  for (const row of rows) {
    if (row.type === "INVOICE_PAYMENT") payments.set(row.id, row)
  }
  return rows
    .filter((row) => row.type !== "INVOICE_PAYMENT")
    .map((row) => {
      if (row.type !== "INVOICE") return row
      const payment = payments.get(row.id)
      if (!payment || !Number(payment.credit)) return row
      return { ...row, credit: payment.credit, runningBalance: payment.runningBalance }
    })
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

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<"statement" | "invoices" | "vouchers">("statement")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const queryClient = useQueryClient()
  const details = useCustomerDetails(id)
  const updateMutation = useUpdateCustomer(id)
  const deleteMutation = useMutation({
    mutationFn: () => deleteCustomer(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      toast({ title: "تم حذف الزبون", description: "فواتيره وبضاعته محفوظة، لكنه لن يظهر في قائمة الزبائن." })
      navigate("/customers")
    },
    onError: () => toast({ title: "تعذر حذف الزبون", variant: "destructive" }),
  })
  const recalcMutation = useMutation({
    mutationFn: () => recalculateCustomerBalance(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer", id] })
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      toast({ title: "تم إعادة حساب الرصيد" })
    },
    onError: () => toast({ title: "تعذر إعادة الحساب", variant: "destructive" }),
  })
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const customer = details.customerQuery.data
  const ratingsQuery = useQuery({ queryKey: ["customer-ratings"], queryFn: getCustomerRatings, staleTime: 5 * 60_000 })
  const myRating = ratingsQuery.data?.find((r) => r.id === id)?.rating ?? null
  const transactions = details.transactionsQuery.data ?? []
  const invoices = details.invoicesQuery.data ?? []
  const vouchers = details.vouchersQuery.data ?? []
  const last = details.lastTransactionQuery.data
  const settings = useSettings().data
  const [portalEnabled, setPortalEnabled] = useState(customer?.portalLinkEnabled ?? false)

  useEffect(() => {
    setPortalEnabled(customer?.portalLinkEnabled ?? false)
  }, [customer?.portalLinkEnabled])

  const portalMutation = useMutation({
    mutationFn: (enable: boolean) => toggleCustomerPortalLink(id!, enable),
    onSuccess: (result: any) => {
      const isEnabled = !result?.revokedAt
      setPortalEnabled(isEnabled)
      toast({
        title: isEnabled ? "✓ الرابط مفعّل" : "✓ الرابط معطّل",
        variant: "default",
      })
    },
    onError: () => {
      toast({
        title: "✗ خطأ في تبديل الرابط",
        variant: "destructive",
      })
    },
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
      date: localDateStr(),
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

  async function togglePortalAndShow() {
    if (!customer) return
    await portalMutation.mutateAsync(!portalEnabled)
  }

  // Sending always mints a FRESH link — once a link is revoked or already
  // sent, its plain token can never be recovered (only its hash is stored),
  // so there's no "old link" to resend. This also activates the portal.
  const sendPortalLinkMutation = useMutation({
    mutationFn: () => createCustomerPortalLink(id!),
    onSuccess: async (link) => {
      setPortalEnabled(true)
      if (!customer?.phone || !link) return
      const url = `${window.location.origin}${link.urlPath}`
      const msg = `مرحباً ${customer.name}،\nهذا رابطك الخاص لمتابعة حسابك وفواتيرك في أي وقت:\n${url}`
      try {
        await sendWhatsAppMessage({ phone: normalizePhone(customer.phone), message: msg })
        toast({ title: "✓ تم إرسال رابط العميل عبر واتساب." })
      } catch {
        toast({ title: "✗ أُنشئ الرابط لكن تعذر إرساله. تحقق من إعدادات واتساب.", variant: "destructive" })
      }
    },
    onError: () => toast({ title: "✗ تعذر إنشاء الرابط.", variant: "destructive" }),
  })

  const lastLink = lastActivityLink(last)
  const lastTimeStr = last?.date
    ? formatDateTime(last.date)
    : customer?.lastTransactionAt
      ? formatDateTime(customer.lastTransactionAt)
      : "-"

  if (!customer) return <div className="text-slate-500">جار تحميل الزبون...</div>

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="px-0" onClick={() => navigate(-1)}>
        <ArrowRight className="h-4 w-4" /> رجوع
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{customer.name}</h1>
            {customer.isBoth && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">زبون ومورد</span>
            )}
            {myRating && (
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
                myRating === "A" ? "bg-emerald-100 text-emerald-700" :
                myRating === "B" ? "bg-sky-100 text-sky-700" :
                "bg-rose-100 text-rose-700"
              }`}>{myRating}</span>
            )}
          </div>
          <p className="text-slate-500">{customer.phone}</p>
          {customer.tags && customer.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {customer.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 text-slate-600" /> تعديل البيانات
          </Button>
          <Button variant="outline" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 text-rose-600" /> حذف الزبون
          </Button>
          <Button variant="outline" onClick={() => void sendStatement()} disabled={!customer.phone}>
            <MessageCircle className="h-4 w-4 text-emerald-600" /> إرسال كشف واتساب
          </Button>
          <Button
            variant={portalEnabled ? "default" : "outline"}
            onClick={togglePortalAndShow}
            disabled={portalMutation.isPending}
          >
            {portalMutation.isPending ? (
              <Copy className="h-4 w-4 animate-pulse" />
            ) : portalEnabled ? (
              <Link2 className="h-4 w-4" />
            ) : (
              <Link2 className="h-4 w-4 text-slate-400" />
            )}
            {portalEnabled ? "رابط العميل مفعّل ✓" : "رابط العميل معطّل"}
          </Button>
          <Button
            variant="outline"
            onClick={() => sendPortalLinkMutation.mutate()}
            disabled={sendPortalLinkMutation.isPending || !customer.phone}
            title="ينشئ رابطاً جديداً ويرسله عبر واتساب"
          >
            <Send className={`h-4 w-4 text-sky-600 ${sendPortalLinkMutation.isPending ? "animate-pulse" : ""}`} />
            إرسال رابط العميل الإلكتروني
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
      {isAdmin && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" disabled={recalcMutation.isPending} onClick={() => recalcMutation.mutate()}>
            {recalcMutation.isPending ? "جاري الحساب..." : "إعادة حساب الرصيد"}
          </Button>
        </div>
      )}

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
      <ConfirmDialog
        open={deleteOpen}
        title={`حذف الزبون «${customer.name}»؟`}
        description="سيختفي الزبون من القائمة، لكن فواتيره وحركة بضاعته تبقى محفوظة في النظام. تقدر تشوفه لاحقاً من «كشف الحساب»."
        confirmLabel="حذف الزبون"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(); setDeleteOpen(false) }}
        onCancel={() => setDeleteOpen(false)}
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
  const merged = useMemo(() => mergeStatementRows(rows), [rows])

  const csv = useMemo(() => {
    const fmtDate = (v: string | null | undefined, dateOnly = false) =>
      v ? (dateOnly ? formatDate(v) : formatDateTime(v)) : ""
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const header = [
      "التاريخ", "وقت الإدخال", "أنشأه", "النوع", "الرقم المرجعي",
      "مدين (على الزبون)", "دائن (للزبون)", "الرصيد", "آخر تعديل",
    ].map(q).join(",")
    const body = merged.map((row) => [
      fmtDate(row.date, true),
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
  }, [merged])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="w-44" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input className="w-44" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <Button variant="outline" asChild><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download={`${customer.name}-statement.csv`}>تصدير Excel</a></Button>
        <CustomerStatementPdfButton customer={customer} rows={merged} />
      </div>
      <Table>
        <THead>
          <TR>
            <TH>التاريخ</TH>
            <TH>النوع / الرقم</TH>
            <TH className="text-rose-700">مدين — على الزبون</TH>
            <TH className="text-emerald-700">دائن — بيه الزبون</TH>
            <TH>الرصيد الكلي</TH>
            <TH>فتح</TH>
          </TR>
        </THead>
        <TBody>{merged.map((row) => {
          const link = transactionLink(row)
          const tone = transactionTone(row)
          const label = translateRow(row)
          const debitAmt = Number(row.debit)
          const creditAmt = Number(row.credit)
          const balance = Number(row.runningBalance)
          return (
            <TR key={`${row.id}-${row.referenceNumber}`} className={`${tone.row} ${link ? "cursor-pointer" : ""}`} style={tone.style}>
              <TD>
                <div className="font-medium">{formatDate(row.date)}</div>
                <div className="text-[11px] text-slate-500">{formatDateTime(row.createdAt)}</div>
              </TD>
              <TD>
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone.label}`}>{label}</span>
                <div className="mt-0.5 text-[11px] text-slate-500">{row.referenceNumber}</div>
                <div className="text-[11px] text-slate-400">{row.createdByName ?? ""}</div>
              </TD>
              <TD className="text-right">
                {debitAmt > 0
                  ? <span className="font-bold text-rose-700">{money(debitAmt)}</span>
                  : <span className="text-slate-300">—</span>}
              </TD>
              <TD className="text-right">
                {creditAmt > 0
                  ? <span className="font-bold text-emerald-700">{money(creditAmt)}</span>
                  : <span className="text-slate-300">—</span>}
              </TD>
              <TD className="text-right">
                <span className={`text-base font-bold ${balance > 0 ? "text-rose-600" : balance < 0 ? "text-emerald-600" : "text-slate-500"}`}>
                  {money(balance)}
                </span>
              </TD>
              <TD>{link ? <Button asChild variant="outline" size="sm"><Link to={link}>فتح</Link></Button> : null}</TD>
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
  const [date, setDate] = useState(localDateStr())
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
    tags: customer.tags ?? [],
    isSupplier: customer.isSupplier ?? false,
    isBoth: customer.isBoth ?? false,
    creditLimit: customer.creditLimit != null ? String(customer.creditLimit) : "",
    openingBalance: String(customer.openingBalance ?? 0),
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
        tags: customer.tags ?? [],
        isSupplier: customer.isSupplier ?? false,
        isBoth: customer.isBoth ?? false,
        creditLimit: customer.creditLimit != null ? String(customer.creditLimit) : "",
        openingBalance: String(customer.openingBalance ?? 0),
      })
    }
  }, [open, customer])

  function set(key: keyof typeof form, value: string | boolean | string[]) {
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
      tags: form.tags,
      isSupplier: form.isSupplier,
      isBoth: form.isBoth,
      creditLimit: form.creditLimit !== "" ? Number(form.creditLimit) : null,
      openingBalance: Number(form.openingBalance) || 0,
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
          <Label>التاكات (اختر بالضغط أو أضف جديد)</Label>
          <TagPicker value={form.tags} onChange={(tags) => set("tags", tags)} />
        </div>

        <div className="space-y-1">
          <Label>الرصيد الافتتاحي (حساب أول المدة) — صحّحه إذا انكتب غلط</Label>
          <Input
            type="number"
            value={form.openingBalance}
            onChange={(e) => set("openingBalance", e.target.value)}
            placeholder="0"
            dir="ltr"
          />
          <p className="text-xs text-amber-600">تغييره يعيد حساب رصيد الزبون الحالي تلقائياً.</p>
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
              { label: "زبون", isSupplier: false, isBoth: false, desc: "قائمة الزبائن فقط" },
              { label: "مورد", isSupplier: true, isBoth: false, desc: "قائمة الموردين فقط" },
              { label: "زبون ومورد", isSupplier: false, isBoth: true, desc: "يظهر في كلا القائمتين" },
            ] as const).map(({ label, isSupplier, isBoth, desc }) => {
              const active = form.isBoth ? isBoth : (form.isSupplier === isSupplier && !isBoth)
              return (
                <label key={label} className={`flex flex-1 cursor-pointer flex-col gap-0.5 rounded-lg border-2 p-3 transition ${active ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="customerType" checked={active} onChange={() => setForm((prev) => ({ ...prev, isSupplier, isBoth }))} className="accent-indigo-600" />
                    <span className="font-semibold text-sm">{label}</span>
                  </div>
                  <span className="text-xs text-slate-500 mr-5">{desc}</span>
                </label>
              )
            })}
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
