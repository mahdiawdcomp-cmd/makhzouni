import { useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { usePageTitle } from "../hooks/usePageTitle"
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Eye, Plus, Receipt, RotateCcw, ShoppingCart } from "lucide-react"
import { useInvoices } from "../hooks/useInvoices"
import type { Invoice, InvoiceType } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { cn } from "../utils/cn"

type TypeFilter = "ALL" | InvoiceType
type InvoiceSort = "createdDesc" | "updatedDesc" | "dateDesc" | "totalDesc" | "remainingDesc" | "paidDesc"

const typeChipStyles: Record<TypeFilter, string> = {
  ALL: "bg-[var(--theme-accent)] text-white",
  SALE: "bg-emerald-600 text-white",
  PURCHASE: "bg-amber-600 text-white",
  SALES_RETURN: "bg-rose-600 text-white",
}

const typeChipIdleStyles =
  "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"

function invoiceParty(invoice: Invoice) {
  const fallbackName = (invoice as Invoice & { customerName?: string }).customerName
  return invoice.customer?.name ?? fallbackName ?? invoice.customerId ?? "-"
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("en-US")
}

function dateValue(value?: string | null) {
  return value ? new Date(value).getTime() || 0 : 0
}

function typeLabel(type: TypeFilter) {
  if (type === "ALL") return "الكل"
  if (type === "SALE") return "فواتير البيع"
  if (type === "PURCHASE") return "فواتير الشراء"
  return "مرتجع المبيعات"
}

function invoiceTypeBadge(type?: InvoiceType) {
  if (type === "PURCHASE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <ShoppingCart className="h-3 w-3" /> شراء
      </span>
    )
  }
  if (type === "SALES_RETURN") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
        <RotateCcw className="h-3 w-3" /> مرتجع
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
      <Receipt className="h-3 w-3" /> بيع
    </span>
  )
}

export function InvoicesPage() {
  usePageTitle("الفواتير")
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlType = searchParams.get("type")
  const typeFilter: TypeFilter = urlType === "SALE" || urlType === "PURCHASE" || urlType === "SALES_RETURN" ? urlType : "ALL"
  const urlFrom = searchParams.get("from") ?? ""
  const urlTo = searchParams.get("to") ?? ""

  const [query, setQuery] = useState("")
  const [draftFrom, setDraftFrom] = useState(urlFrom)
  const [draftTo, setDraftTo] = useState(urlTo)
  const [draftStatus, setDraftStatus] = useState("all")
  const [draftPaymentType, setDraftPaymentType] = useState("all")
  const [sortBy, setSortBy] = useState<InvoiceSort>("createdDesc")
  const [appliedFilters, setAppliedFilters] = useState({
    from: urlFrom,
    to: urlTo,
    status: "all",
    paymentType: "all",
  })

  function selectType(next: TypeFilter) {
    const params = new URLSearchParams(searchParams)
    if (next === "ALL") params.delete("type")
    else params.set("type", next)
    setSearchParams(params, { replace: true })
  }

  const invoicesQuery = useInvoices({
    from: appliedFilters.from || undefined,
    to: appliedFilters.to || undefined,
    status: appliedFilters.status === "ACTIVE" || appliedFilters.status === "CANCELLED" ? appliedFilters.status : undefined,
    type: typeFilter === "ALL" ? undefined : typeFilter,
    paymentType:
      appliedFilters.paymentType === "CASH" || appliedFilters.paymentType === "CREDIT" || appliedFilters.paymentType === "PARTIAL"
        ? appliedFilters.paymentType
        : undefined,
  })

  const invoices = invoicesQuery.data ?? []
  const filtered = invoices
    .filter((invoice) => {
      const paid = Number(invoice.remainingAmount ?? 0) <= 0
      const matchesStatus =
        appliedFilters.status === "all" ||
        appliedFilters.status === "ACTIVE" ||
        appliedFilters.status === "CANCELLED" ||
        (appliedFilters.status === "paid" && paid && invoice.status !== "CANCELLED") ||
        (appliedFilters.status === "unpaid" && !paid && invoice.status !== "CANCELLED")
      const search = query.trim().toLowerCase()
      const matchesSearch =
        search === "" ||
        invoice.invoiceNumber.toLowerCase().includes(search) ||
        invoiceParty(invoice).toLowerCase().includes(search)
      return matchesStatus && matchesSearch
    })
    .sort((a, b) => {
      if (sortBy === "updatedDesc") return dateValue(b.updatedAt) - dateValue(a.updatedAt)
      if (sortBy === "dateDesc") return dateValue(b.date) - dateValue(a.date)
      if (sortBy === "totalDesc") return Number(b.totalAmount) - Number(a.totalAmount)
      if (sortBy === "remainingDesc") return Number(b.remainingAmount) - Number(a.remainingAmount)
      if (sortBy === "paidDesc") return Number(b.paidAmount) - Number(a.paidAmount)
      return dateValue(b.createdAt ?? b.date) - dateValue(a.createdAt ?? a.date)
    })

  const columns = useMemo<ColumnDef<Invoice>[]>(
    () => [
      { id: "type", header: "النوع", cell: ({ row }) => invoiceTypeBadge(row.original.type) },
      { accessorKey: "invoiceNumber", header: "رقم الفاتورة" },
      { id: "customer", header: "الزبون / المورد", cell: ({ row }) => invoiceParty(row.original) },
      { accessorKey: "date", header: "التاريخ", cell: ({ row }) => String(row.original.date).slice(0, 10) },
      { accessorKey: "totalAmount", header: "الإجمالي", cell: ({ row }) => money(row.original.totalAmount) },
      { accessorKey: "paidAmount", header: "المدفوع", cell: ({ row }) => money(row.original.paidAmount) },
      { accessorKey: "remainingAmount", header: "الباقي", cell: ({ row }) => money(row.original.remainingAmount) },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => {
          const status = row.original.status
          if (status === "ACTIVE") return <Badge variant="success">نشطة</Badge>
          if (status === "CANCELLED") return <Badge variant="danger">ملغاة</Badge>
          if (status === "PENDING") return <Badge variant="warning">قيد الانتظار</Badge>
          return <Badge>{status}</Badge>
        },
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => (
          <Button
            variant="outline"
            title="عرض الفاتورة (تبويب جديد)"
            onClick={() => window.open(`/invoices/${row.original.id}`, "_blank", "noopener,noreferrer")}
          >
            <Eye className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: filtered,
    columns,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold">الفواتير</h1>
          <p className="text-slate-500">قائمة الفواتير مع البحث والتصفية والفرز.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/invoices/new?type=PURCHASE")}>
            <ShoppingCart className="h-4 w-4" /> فاتورة شراء
          </Button>
          <Button variant="outline" asChild>
            <Link to="/invoices/returns">
              <RotateCcw className="h-4 w-4" /> مرتجع مبيعات
            </Link>
          </Button>
          <Button onClick={() => navigate("/invoices/new?type=SALE")}>
            <Plus className="h-4 w-4" /> فاتورة بيع
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["ALL", "SALE", "PURCHASE", "SALES_RETURN"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => selectType(type)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition",
              typeFilter === type ? typeChipStyles[type] : typeChipIdleStyles,
            )}
          >
            {typeLabel(type)}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>جدول الفواتير</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 xl:grid-cols-[1fr_150px_150px_160px_160px_190px_110px]">
            <Input
              placeholder="بحث برقم الفاتورة أو اسم الزبون"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} />
            <Input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} />
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              value={draftStatus}
              onChange={(event) => setDraftStatus(event.target.value)}
            >
              <option value="all">كل الحالات</option>
              <option value="ACTIVE">نشطة</option>
              <option value="CANCELLED">ملغاة</option>
              <option value="paid">مدفوعة</option>
              <option value="unpaid">غير مدفوعة</option>
            </select>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              value={draftPaymentType}
              onChange={(event) => setDraftPaymentType(event.target.value)}
            >
              <option value="all">كل الدفع</option>
              <option value="CASH">كاش</option>
              <option value="CREDIT">آجل</option>
              <option value="PARTIAL">جزئي</option>
            </select>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as InvoiceSort)}
            >
              <option value="createdDesc">الأحدث إضافة</option>
              <option value="updatedDesc">آخر تعديل</option>
              <option value="dateDesc">تاريخ الفاتورة</option>
              <option value="totalDesc">أعلى مبلغ</option>
              <option value="remainingDesc">أعلى باقي</option>
              <option value="paidDesc">أعلى مدفوع</option>
            </select>
            <Button onClick={() => setAppliedFilters({ from: draftFrom, to: draftTo, status: draftStatus, paymentType: draftPaymentType })}>بحث</Button>
          </div>

          <Table>
            <THead>
              {table.getHeaderGroups().map((group) => (
                <TR key={group.id}>
                  {group.headers.map((header) => (
                    <TH key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TH>
                  ))}
                </TR>
              ))}
            </THead>
            <TBody>
              {table.getRowModel().rows.map((row) => (
                <TR
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"
                  onDoubleClick={() => window.open(`/invoices/${row.original.id}`, "_blank", "noopener,noreferrer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>
                  ))}
                </TR>
              ))}
              {!invoicesQuery.isLoading && table.getRowModel().rows.length === 0 ? (
                <TR>
                  <TD colSpan={columns.length} className="py-8 text-center text-slate-500">
                    لا توجد فواتير مطابقة
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              السابق
            </Button>
            <span className="text-sm text-slate-500">
              صفحة {table.getState().pagination.pageIndex + 1} من {table.getPageCount() || 1}
            </span>
            <Button variant="outline" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              التالي
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
