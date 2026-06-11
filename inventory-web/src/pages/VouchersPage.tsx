import { useEffect, useMemo, useRef, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, Plus, Receipt, ReceiptText, RefreshCw, Wallet } from "lucide-react"
import { createVoucher, getCustomers, getVouchers } from "../api/endpoints"
import type { Voucher } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { cn } from "../utils/cn"

type Type = Voucher["type"]
type FilterType = "ALL" | Type

const typeMeta: Record<Type, { label: string; icon: typeof Receipt; rowTint: string; chip: string }> = {
  RECEIPT: { label: "قبض",     icon: Receipt,     rowTint: "bg-emerald-50 dark:bg-emerald-950/20", chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" },
  PAYMENT: { label: "دفع",     icon: ReceiptText, rowTint: "bg-orange-50 dark:bg-orange-950/20",   chip: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200" },
  EXPENSE: { label: "مصاريف",  icon: Wallet,      rowTint: "bg-rose-50 dark:bg-rose-950/20",       chip: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200" },
}

const filterChipIdle =
  "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"

export function VouchersPage() {
  usePageTitle("السندات")
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlType = searchParams.get("type") as FilterType | null
  const urlAction = searchParams.get("action") as Type | null

  const [typeFilter, setTypeFilter] = useState<FilterType>(
    urlType === "RECEIPT" || urlType === "PAYMENT" || urlType === "EXPENSE" ? urlType : "ALL",
  )

  const [closeVoucherConfirm, setCloseVoucherConfirm] = useState(false)

  // Voucher creation dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [type, setType] = useState<Type>("RECEIPT")
  const [customerId, setCustomerId] = useState("")
  const [customerQuery, setCustomerQuery] = useState("")
  const [customerListOpen, setCustomerListOpen] = useState(false)
  const [customerHighlight, setCustomerHighlight] = useState(0)
  const [amount, setAmount] = useState("")
  const [notes, setNotes] = useState("")
  const [description, setDescription] = useState("")
  const amountRef = useRef<HTMLInputElement | null>(null)

  // Auto-open dialog if URL has ?action=...
  useEffect(() => {
    if (urlAction === "RECEIPT" || urlAction === "PAYMENT" || urlAction === "EXPENSE") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType(urlAction)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDialogOpen(true)
      // Clear the param so refreshing doesn't keep reopening
      searchParams.delete("action")
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAction])

  function selectFilter(next: FilterType) {
    setTypeFilter(next)
    if (next === "ALL") searchParams.delete("type")
    else searchParams.set("type", next)
    setSearchParams(searchParams, { replace: true })
  }

  function openCreate(t: Type) {
    setType(t)
    setCustomerId("")
    setCustomerQuery("")
    setAmount("")
    setNotes("")
    setDescription("")
    setDialogOpen(true)
  }

  const vouchersQuery = useQuery({
    queryKey: ["vouchers", typeFilter],
    queryFn: () => getVouchers(typeFilter === "ALL" ? undefined : { type: typeFilter }),
  })
  const customersQuery = useQuery({
    queryKey: ["customers", "voucher-picker"],
    queryFn: () => getCustomers(),
  })

  const allCustomers = customersQuery.data ?? []
  const customerSuggestions = customerQuery.trim().length >= 1
    ? allCustomers
        .filter((c) =>
          c.name.includes(customerQuery) ||
          c.phone.includes(customerQuery)
        )
        .slice(0, 6)
    : []

  function pickCustomer(id: string, name: string) {
    setCustomerId(id)
    setCustomerQuery(name)
    setCustomerListOpen(false)
    setCustomerHighlight(0)
    window.setTimeout(() => amountRef.current?.focus(), 0)
  }

  function fmtNumInput(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, "")
    if (!digits) return ""
    return Number(digits).toLocaleString("en-US")
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createVoucher({
        type,
        customerId: type === "EXPENSE" ? undefined : customerId,
        amount: Number(amount.replace(/,/g, "")),
        notes: notes || undefined,
        description: description || undefined,
      }),
    onSuccess: () => {
      setDialogOpen(false)
      setCustomerId(""); setAmount(""); setNotes(""); setDescription("")
      void queryClient.invalidateQueries({ queryKey: ["vouchers"] })
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
      void queryClient.invalidateQueries({ queryKey: ["customer"] })
      void queryClient.invalidateQueries({ queryKey: ["transactions"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
    },
  })

  const vouchers = useMemo(() => vouchersQuery.data ?? [], [vouchersQuery.data])

  const canSubmit =
    Number(amount.replace(/,/g, "")) > 0 &&
    (type === "EXPENSE" ? description.trim().length > 0 : !!customerId) &&
    !createMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">السندات</h1>
          <p className="text-slate-500">سندات القبض والدفع والمصاريف العامة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => openCreate("RECEIPT")} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> سند قبض
          </Button>
          <Button onClick={() => openCreate("PAYMENT")} className="bg-orange-500 hover:bg-orange-600">
            <Plus className="h-4 w-4" /> سند دفع
          </Button>
          <Button onClick={() => openCreate("EXPENSE")} className="bg-rose-500 hover:bg-rose-600">
            <Plus className="h-4 w-4" /> مصاريف أخرى
          </Button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => selectFilter("ALL")}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition",
            typeFilter === "ALL" ? "bg-[var(--theme-accent)] text-white" : filterChipIdle,
          )}
        >
          الكل
        </button>
        {(["RECEIPT", "PAYMENT", "EXPENSE"] as const).map((t) => {
          const meta = typeMeta[t]
          const Icon = meta.icon
          const active = typeFilter === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => selectFilter(t)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition",
                active ? "bg-[var(--theme-accent)] text-white" : filterChipIdle,
              )}
            >
              <Icon className="h-4 w-4" />
              {meta.label}
            </button>
          )
        })}
      </div>

      <Card>
        <CardHeader><CardTitle>جدول السندات</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>النوع</TH>
                <TH>الرقم</TH>
                <TH>المبلغ</TH>
                <TH>الزبون / الوصف</TH>
                <TH>التاريخ</TH>
                <TH>عرض</TH>
              </TR>
            </THead>
            <TBody>
              {vouchers.map((voucher) => {
                const meta = typeMeta[voucher.type]
                const Icon = meta.icon
                return (
                  <TR key={voucher.id} className={meta.rowTint}>
                    <TD>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", meta.chip)}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </span>
                    </TD>
                    <TD>{voucher.voucherNumber}</TD>
                    <TD>{Number(voucher.amount).toLocaleString("en-US")}</TD>
                    <TD>{voucher.customer?.name ?? voucher.description ?? "—"}</TD>
                    <TD>{String(voucher.date).slice(0, 10)}</TD>
                    <TD>
                      <Button
                        variant="outline"
                        title="عرض السند (تبويب جديد)"
                        onClick={() => window.open(`/vouchers/${voucher.id}`, "_blank", "noopener,noreferrer")}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TD>
                  </TR>
                )
              })}
              {vouchers.length === 0 ? (
                <TR><TD colSpan={6} className="py-6 text-center text-sm text-slate-500">لا توجد سندات.</TD></TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog — warn if amount filled but not saved */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && amount.replace(/,/g, "").trim() !== "") {
            setCloseVoucherConfirm(true); return
          }
          setDialogOpen(open)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {type === "RECEIPT" ? "سند قبض جديد" : type === "PAYMENT" ? "سند دفع جديد" : "مصاريف أخرى"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["RECEIPT", "PAYMENT", "EXPENSE"] as const).map((t) => {
                const meta = typeMeta[t]
                const Icon = meta.icon
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                      type === t
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)]"
                        : filterChipIdle,
                    )}
                  >
                    <Icon className="ml-1 inline h-4 w-4" />
                    {meta.label}
                  </button>
                )
              })}
            </div>

            {type === "EXPENSE" ? (
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="نوع المصروف (مثل: أجور مولّدة)"
              />
            ) : (
              <>
                {/* ── Searchable customer autocomplete ── */}
                <div className="relative">
                  <Input
                    placeholder={`ابحث عن ${type === "RECEIPT" ? "الزبون" : "المستلِم"} بالاسم أو الهاتف...`}
                    value={customerQuery}
                    onChange={(e) => {
                      setCustomerQuery(e.target.value)
                      setCustomerId("")
                      setCustomerListOpen(true)
                      setCustomerHighlight(0)
                    }}
                    onFocus={() => { if (customerQuery) setCustomerListOpen(true) }}
                    onBlur={() => window.setTimeout(() => setCustomerListOpen(false), 150)}
                    onKeyDown={(e) => {
                      if (!customerSuggestions.length) return
                      if (e.key === "ArrowDown") {
                        e.preventDefault()
                        setCustomerHighlight((i) => Math.min(i + 1, customerSuggestions.length - 1))
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault()
                        setCustomerHighlight((i) => Math.max(i - 1, 0))
                      } else if (e.key === "Enter") {
                        e.preventDefault()
                        const selected = customerSuggestions[customerHighlight] ?? customerSuggestions[0]
                        pickCustomer(selected.id, selected.name)
                      }
                    }}
                  />
                  {customerListOpen && customerSuggestions.length > 0 && (
                    <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950">
                      {customerSuggestions.map((c, index) => (
                        <button
                          key={c.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between border-b border-slate-100 px-4 py-2.5 text-right text-sm hover:bg-blue-50 dark:border-slate-800 dark:hover:bg-slate-800",
                            index === customerHighlight && "bg-blue-50 dark:bg-slate-800",
                          )}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickCustomer(c.id, c.name)}
                        >
                          <div>
                            <div className="font-semibold">{c.name}</div>
                            <div className="text-xs text-slate-500">{c.phone}</div>
                          </div>
                          <span className={`text-xs font-bold ${Number(c.currentBalance) > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                            {Number(c.currentBalance).toLocaleString("en-US")} د.ع
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Show selected customer balance */}
                {customerId ? (() => {
                  const cust = allCustomers.find((c) => c.id === customerId)
                  if (!cust) return null
                  return (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex justify-between">
                        <span className="text-slate-500">الرصيد الحالي</span>
                        <span className={`font-bold ${Number(cust.currentBalance) > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {Number(cust.currentBalance).toLocaleString("en-US")} د.ع
                        </span>
                      </div>
                      {cust.lastTransactionAt ? (
                        <div className="mt-1 flex justify-between text-xs text-slate-500">
                          <span>آخر معاملة</span>
                          <span>{new Date(cust.lastTransactionAt).toLocaleDateString("en-US")}</span>
                        </div>
                      ) : null}
                    </div>
                  )
                })() : null}
              </>
            )}

            <Input
              inputMode="numeric"
              ref={amountRef}
              value={amount}
              onChange={(event) => setAmount(fmtNumInput(event.target.value))}
              placeholder="المبلغ"
              onFocus={(e) => e.target.select()}
              dir="ltr"
            />
            <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-600">
              تاريخ السند يثبت تلقائياً عند الحفظ
            </div>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات اختيارية" />

            <Button className="w-full" onClick={() => createMutation.mutate()} disabled={!canSubmit}>
              {createMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              حفظ السند
            </Button>
            {createMutation.isError ? (
              <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
                {createMutation.error instanceof Error ? createMutation.error.message : "تعذر الحفظ"}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={closeVoucherConfirm}
        title="خروج بدون حفظ؟"
        description="لم تحفظ السند بعد."
        confirmLabel="خروج"
        onConfirm={() => {
          setCloseVoucherConfirm(false)
          setAmount(""); setNotes(""); setDescription(""); setCustomerId(""); setCustomerQuery("")
          setDialogOpen(false)
        }}
        onCancel={() => setCloseVoucherConfirm(false)}
      />
    </div>
  )
}
