import { useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Document, Page, PDFDownloadLink, Text, View } from "@react-pdf/renderer"
import { ArrowRight, MessageCircle } from "lucide-react"
import { fmt } from "../utils/fmt"
import { useCustomers, useCustomerDetails } from "../hooks/useCustomers"
import { useSettings } from "../hooks/useSettings"
import { fillTemplate, openWhatsApp } from "../utils/whatsapp"
import type { Customer, CustomerTransaction, ReceiptPayload } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

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
  if (t.includes("INVOICE")) return "فاتورة"
  if (t.includes("VOUCHER")) return "سند"
  return type
}

function lastActivityLink(last: { type?: string; id?: string } | undefined | null): string | null {
  if (!last?.id || !last?.type) return null
  const t = String(last.type).toUpperCase()
  if (t.includes("VOUCHER") || t === "RECEIPT" || t === "PAYMENT" || t === "EXPENSE") return `/vouchers/${last.id}`
  if (t.includes("INVOICE") || t === "SALE" || t === "PURCHASE") return `/invoices/${last.id}`
  return null
}

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<"statement" | "invoices" | "vouchers">("statement")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [receiptOpen, setReceiptOpen] = useState(false)
  const details = useCustomerDetails(id)
  const customer = details.customerQuery.data
  const transactions = details.transactionsQuery.data ?? []
  const invoices = details.invoicesQuery.data ?? []
  const vouchers = details.vouchersQuery.data ?? []
  const last = details.lastTransactionQuery.data
  const settings = useSettings().data

  const filteredTransactions = transactions.filter((row) => {
    const date = String(row.date).slice(0, 10)
    return (!from || date >= from) && (!to || date <= to)
  })

  const totalPurchases = invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount ?? 0), 0)
  const totalReceived = vouchers
    .filter((v) => v.type === "RECEIPT")
    .reduce((sum, v) => sum + Number(v.amount ?? 0), 0)

  function sendStatement() {
    if (!customer) return
    const tpl = settings?.statementTemplate || DEFAULT_STATEMENT_TEMPLATE
    const msg = fillTemplate(tpl, {
      customerName: customer.name,
      date: new Date().toISOString().slice(0, 10),
      openingBalance: money(customer.openingBalance),
      currentBalance: money(customer.currentBalance),
      currency: settings?.currency ?? "د.ع",
      storeName: settings?.storeName ?? "",
    })
    openWhatsApp(customer.phone, msg)
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
          <Button variant="outline" onClick={sendStatement} disabled={!customer.phone}>
            <MessageCircle className="h-4 w-4 text-emerald-600" /> إرسال كشف واتساب
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
    const header = "date,type,debit,credit,balance"
    const body = rows.map((row) => [row.date, row.type, row.debit ?? 0, row.credit ?? 0, row.runningBalance].join(","))
    return [header, ...body].join("\n")
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
        <THead><TR><TH>التاريخ</TH><TH>النوع</TH><TH>مدين</TH><TH>دائن</TH><TH>الرصيد</TH></TR></THead>
        <TBody>{rows.map((row) => <TR key={row.id} className="cursor-pointer"><TD>{String(row.date).slice(0, 10)}</TD><TD>{row.type}</TD><TD>{row.debit ?? 0}</TD><TD>{row.credit ?? 0}</TD><TD>{row.runningBalance}</TD></TR>)}</TBody>
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
