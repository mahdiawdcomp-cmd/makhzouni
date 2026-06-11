import { useMemo, useState, type FormEvent } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useNavigate } from "react-router-dom"
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Eye, Plus, Receipt } from "lucide-react"
import { useCustomers } from "../hooks/useCustomers"
import type { Customer, CustomerPayload } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

const emptyCustomer: CustomerPayload = {
  name: "",
  phone: "",
  address: "",
  notes: "",
  openingBalance: 0,
  isSupplier: false,
}

type CustomerSort = "createdDesc" | "updatedDesc" | "balanceDesc" | "balanceAsc" | "nameAsc" | "lastDesc"

function dateValue(value?: string | null) {
  return value ? new Date(value).getTime() || 0 : 0
}

export function CustomersPage() {
  usePageTitle("الزبائن")
  const navigate = useNavigate()
  const [isSupplierTab, setIsSupplierTab] = useState(false)
  const { customersQuery, createMutation } = useCustomers(isSupplierTab)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const [sortBy, setSortBy] = useState<CustomerSort>("createdDesc")
  const [open, setOpen] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [form, setForm] = useState<CustomerPayload>(emptyCustomer)
  const customers = customersQuery.data ?? []
  const now = Date.now()

  const filtered = customers.filter((customer) => {
    const matchesSearch =
      query.trim() === "" ||
      customer.name.toLowerCase().includes(query.toLowerCase()) ||
      customer.phone.includes(query)
    const isDebtor = customer.currentBalance > 0
    const last = customer.lastTransactionAt ? new Date(customer.lastTransactionAt).getTime() : 0
    const isInactive = !last || now - last > 30 * 86400000
    const matchesFilter = filter === "all" || (filter === "debtors" && isDebtor) || (filter === "inactive" && isInactive)
    return matchesSearch && matchesFilter
  }).sort((a, b) => {
    if (sortBy === "updatedDesc") return dateValue(b.updatedAt) - dateValue(a.updatedAt)
    if (sortBy === "balanceDesc") return Number(b.currentBalance) - Number(a.currentBalance)
    if (sortBy === "balanceAsc") return Number(a.currentBalance) - Number(b.currentBalance)
    if (sortBy === "nameAsc") return a.name.localeCompare(b.name)
    if (sortBy === "lastDesc") return dateValue(b.lastTransactionAt) - dateValue(a.lastTransactionAt)
    return dateValue(b.createdAt) - dateValue(a.createdAt)
  })

  const columns = useMemo<ColumnDef<Customer>[]>(
    () => [
      { accessorKey: "name", header: "الاسم" },
      { accessorKey: "phone", header: "الهاتف" },
      { accessorKey: "address", header: "العنوان", cell: ({ row }) => row.original.address ?? "-" },
      {
        accessorKey: "currentBalance",
        header: "الرصيد",
        cell: ({ row }) => (
          <span className={row.original.currentBalance > 0 ? "text-red-600" : "text-emerald-600"}>
            {row.original.currentBalance}
          </span>
        ),
      },
      { accessorKey: "lastTransactionAt", header: "آخر تعامل", cell: ({ row }) => row.original.lastTransactionAt?.slice(0, 10) ?? "-" },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/customers/${row.original.id}`)}><Eye className="h-4 w-4" /></Button>
            <Button variant="outline" onClick={() => navigate(`/customers/${row.original.id}?receipt=1`)}><Receipt className="h-4 w-4" /></Button>
          </div>
        ),
      },
    ],
    [navigate],
  )

  const table = useReactTable({
    data: filtered,
    columns,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.name || !form.phone) return
    createMutation.mutate(form, {
      onSuccess: () => {
        setOpen(false)
        setForm(emptyCustomer)
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">الزبائن والموردين</h1>
          <p className="text-slate-500">كشف الحساب والأرصدة والسندات.</p>
        </div>
        <Button onClick={() => { setForm({ ...emptyCustomer, isSupplier: isSupplierTab }); setOpen(true); }}>
          <Plus className="h-4 w-4" /> {isSupplierTab ? "مورد جديد" : "زبون جديد"}
        </Button>
      </div>
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button
          className={`px-4 py-2 text-sm font-medium ${!isSupplierTab ? "border-b-2 border-indigo-500 text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
          onClick={() => setIsSupplierTab(false)}
        >
          الزبائن
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${isSupplierTab ? "border-b-2 border-indigo-500 text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
          onClick={() => setIsSupplierTab(true)}
        >
          الموردين
        </button>
      </div>
      <Card>
        <CardHeader><CardTitle>جدول {isSupplierTab ? "الموردين" : "الزبائن"}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px_240px]">
            <Input placeholder="بحث بالاسم أو الهاتف" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">الكل</option>
              <option value="debtors">المدينون فقط</option>
              <option value="inactive">الغائبون</option>
            </select>
          </div>
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" value={sortBy} onChange={(event) => setSortBy(event.target.value as CustomerSort)}>
              <option value="createdDesc">الأحدث إضافة</option>
              <option value="updatedDesc">آخر تعديل</option>
              <option value="lastDesc">آخر تعامل</option>
              <option value="balanceDesc">أعلى رصيد</option>
              <option value="balanceAsc">أقل رصيد</option>
              <option value="nameAsc">الاسم أ-ي</option>
            </select>
          <Table>
            <THead>
              {table.getHeaderGroups().map((headerGroup) => (
                <TR key={headerGroup.id}>{headerGroup.headers.map((header) => <TH key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TH>)}</TR>
              ))}
            </THead>
            <TBody>
              {table.getRowModel().rows.map((row) => (
                <TR key={row.id}>{row.getVisibleCells().map((cell) => <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>)}</TR>
              ))}
            </TBody>
          </Table>
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>السابق</Button>
            <span className="text-sm text-slate-500">صفحة {table.getState().pagination.pageIndex + 1} من {table.getPageCount() || 1}</span>
            <Button variant="outline" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>التالي</Button>
          </div>
        </CardContent>
      </Card>
      <ModalForm
        open={open}
        onOpenChange={(v) => {
          if (!v && (form.name.trim() || form.phone.trim())) {
            setCloseConfirm(true); return
          }
          setOpen(v)
        }}
        title="إضافة زبون"
      >
        <form className="space-y-3" onSubmit={submit}>
          <Input required placeholder="الاسم" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input required placeholder="الهاتف" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          <Input placeholder="العنوان" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          <Input placeholder="ملاحظات" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
            <label className="mb-1 block text-xs font-semibold text-amber-800 dark:text-amber-300">
              الرصيد الافتتاحي (مطلوب إذا كان للزبون حساب سابق)
            </label>
            <Input
              type="number"
              placeholder="مثال: 150000 (موجب = مدين لنا، سالب = نحن مدينون)"
              value={form.openingBalance}
              onChange={(event) => setForm({ ...form, openingBalance: Number(event.target.value) })}
              className="border-amber-300 dark:border-amber-700"
            />
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              اتركه صفر إذا كان زبون جديد بلا ديون سابقة.
            </p>
          </div>
          <div className="space-y-1 mt-1">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">النوع</p>
            <div className="flex gap-2">
              {([
                { label: "زبون", value: false },
                { label: "مورد", value: true },
              ] as const).map(({ label, value }) => (
                <label key={label} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border-2 p-2.5 transition ${form.isSupplier === value ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}>
                  <input type="radio" name="newCustomerType" checked={form.isSupplier === value} onChange={() => setForm({ ...form, isSupplier: value })} className="accent-indigo-600" />
                  <span className="font-semibold text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <Button className="w-full" type="submit">حفظ</Button>
        </form>
      </ModalForm>

      <ConfirmDialog
        open={closeConfirm}
        title="خروج بدون حفظ؟"
        description="لم تحفظ الزبون بعد."
        confirmLabel="خروج"
        onConfirm={() => { setCloseConfirm(false); setForm(emptyCustomer); setOpen(false) }}
        onCancel={() => setCloseConfirm(false)}
      />
    </div>
  )
}
