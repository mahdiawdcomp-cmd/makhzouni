import { useMemo, useState, type KeyboardEvent } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Plus } from "lucide-react"
import { convertQuotation, createQuotation, getCustomers, getProducts, getQuotations, updateQuotationStatus } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import type { Customer } from "../types/api"
import { cn } from "../utils/cn"

type Line = { productId: string; quantity: number; unitPrice: number }

function money(value: number) {
  return new Intl.NumberFormat("ar-IQ").format(Math.round(value))
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function normalize(value: string | undefined | null) {
  return String(value ?? "").trim().toLowerCase()
}

export function QuotationsPage() {
  usePageTitle("عروض الأسعار")
  const queryClient = useQueryClient()
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: () => getCustomers({ limit: 100 }) })
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => getProducts({ limit: 100 }) })
  const quotationsQuery = useQuery({ queryKey: ["quotations"], queryFn: () => getQuotations() })
  const [customerId, setCustomerId] = useState("")
  const [customerQuery, setCustomerQuery] = useState("")
  const [customerHighlight, setCustomerHighlight] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [expiresAt, setExpiresAt] = useState(todayDate())
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<Line[]>([])

  const products = productsQuery.data ?? []
  const customers = customersQuery.data ?? []
  const customerSuggestions = useMemo(() => {
    const q = normalize(customerQuery)
    if (!q) return customers.slice(0, 8)
    return customers.filter((customer) => normalize(customer.name).includes(q) || normalize(customer.phone).includes(q)).slice(0, 8)
  }, [customers, customerQuery])
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  const total = Math.max(0, subtotal - discount)

  const createMutation = useMutation({
    mutationFn: () =>
      createQuotation({
        customerId,
        discount,
        expiresAt: expiresAt || undefined,
        notes: notes || undefined,
        items: lines.map((line) => ({ productId: line.productId, unit: "PIECE", quantity: line.quantity, unitPrice: line.unitPrice })),
      }),
    onSuccess: () => {
      setCustomerId(""); setCustomerQuery(""); setDiscount(0); setExpiresAt(todayDate()); setNotes(""); setLines([])
      void queryClient.invalidateQueries({ queryKey: ["quotations"] })
    },
  })
  const convertMutation = useMutation({
    mutationFn: convertQuotation,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["quotations"] }),
  })
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACCEPTED" | "REJECTED" | "EXPIRED" }) => updateQuotationStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["quotations"] }),
  })

  function addLine(productId: string) {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setLines((prev) => [...prev, { productId, quantity: 1, unitPrice: product.salePrice }])
  }

  function chooseCustomer(customer: Customer) {
    setCustomerId(customer.id)
    setCustomerQuery(customer.name)
    setCustomerHighlight(0)
  }

  function handleCustomerKey(event: KeyboardEvent<HTMLInputElement>) {
    if (!customerSuggestions.length) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setCustomerHighlight((index) => Math.min(index + 1, customerSuggestions.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setCustomerHighlight((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      chooseCustomer(customerSuggestions[customerHighlight] ?? customerSuggestions[0])
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">عروض الأسعار</h1>
        <p className="text-slate-500">اعرض سعر للزبون قبل تحويله لفاتورة بيع.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>عرض جديد</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="relative">
              <label className="mb-1 block text-xs font-semibold text-slate-500">الزبون</label>
              <Input
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value)
                  setCustomerId("")
                  setCustomerHighlight(0)
                }}
                onKeyDown={handleCustomerKey}
                placeholder="اكتب اسم أو هاتف الزبون"
              />
              {!customerId && customerQuery ? (
                <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-white shadow-lg">
                  {customerSuggestions.map((customer, index) => (
                    <button
                      key={customer.id}
                      type="button"
                      className={cn("flex w-full items-center justify-between px-3 py-2 text-right text-sm", index === customerHighlight ? "bg-blue-50" : "hover:bg-slate-50")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseCustomer(customer)}
                    >
                      <span className="font-medium">{customer.name}</span>
                      <span className="text-xs text-slate-500">{customer.phone}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">الخصم</span>
              <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} placeholder="0" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">تاريخ الصلاحية</span>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">ملاحظات</span>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
            </label>
          </div>
          <div className="flex gap-2">
            <select className="h-10 flex-1 rounded-md border px-3 text-sm" onChange={(e) => { addLine(e.target.value); e.currentTarget.value = "" }} defaultValue="">
              <option value="">أضف مادة</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} - {money(p.salePrice)}</option>)}
            </select>
            <Button onClick={() => createMutation.mutate()} disabled={!customerId || lines.length === 0 || total < 0 || createMutation.isPending}>
              <Plus className="h-4 w-4" /> حفظ العرض
            </Button>
          </div>
          <Table>
            <THead><TR><TH>المادة</TH><TH>العدد</TH><TH>السعر</TH><TH>المجموع</TH></TR></THead>
            <TBody>
              {lines.map((line, index) => {
                const p = products.find((product) => product.id === line.productId)
                return (
                  <TR key={index}>
                    <TD>{p?.name ?? line.productId}</TD>
                    <TD><Input type="number" value={line.quantity} onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? { ...x, quantity: Number(e.target.value) } : x))} /></TD>
                    <TD><Input type="number" value={line.unitPrice} onChange={(e) => setLines((prev) => prev.map((x, i) => i === index ? { ...x, unitPrice: Number(e.target.value) } : x))} /></TD>
                    <TD>{money(line.quantity * line.unitPrice)}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
          <div className="text-left font-bold">الإجمالي: {money(total)}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>العروض</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>الرقم</TH><TH>الزبون</TH><TH>الحالة</TH><TH>المبلغ</TH><TH>الصلاحية</TH><TH>إجراءات</TH></TR></THead>
            <TBody>
              {(quotationsQuery.data ?? []).map((q) => (
                <TR key={q.id}>
                  <TD>{q.quotationNumber}</TD>
                  <TD>{q.customer?.name ?? q.customerId}</TD>
                  <TD>{q.status}</TD>
                  <TD>{money(q.totalAmount)}</TD>
                  <TD>{q.expiresAt?.slice(0, 10) ?? "-"}</TD>
                  <TD className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: q.id, status: "ACCEPTED" })}>قبول</Button>
                    <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: q.id, status: "REJECTED" })}>رفض</Button>
                    <Button size="sm" onClick={() => convertMutation.mutate(q.id)} disabled={q.status === "CONVERTED"}>
                      <FileText className="h-4 w-4" /> تحويل لفاتورة
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
