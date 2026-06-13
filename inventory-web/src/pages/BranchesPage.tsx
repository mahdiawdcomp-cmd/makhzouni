import { useMemo, useState, type FormEvent } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Building2, Edit, Eye, Plus, Search } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createBranch, getBranches, getBranchSummaries, updateBranch } from "../api/endpoints"
import type { Branch, BranchPayload } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

const emptyForm: BranchPayload = {
  name: "",
  code: "",
  phone: "",
  address: "",
  isActive: true,
}

export function BranchesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchDraft, setSearchDraft] = useState("")
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all")
  const [open, setOpen] = useState(false)
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null)
  const [form, setForm] = useState<BranchPayload>(emptyForm)

  const branchesQuery = useQuery({
    queryKey: ["branches", search, activeFilter],
    queryFn: () =>
      getBranches({
        search: search || undefined,
        isActive: activeFilter === "all" ? undefined : activeFilter === "active",
      }),
  })
  const summariesQuery = useQuery({
    queryKey: ["branches", "summaries"],
    queryFn: getBranchSummaries,
  })

  const saveBranch = useMutation({
    mutationFn: (payload: BranchPayload) =>
      editingBranch ? updateBranch(editingBranch.id, payload) : createBranch(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] })
      setOpen(false)
      setEditingBranch(null)
      setForm(emptyForm)
      queryClient.invalidateQueries({ queryKey: ["branches", "summaries"] })
    },
  })

  const columns = useMemo<ColumnDef<Branch>[]>(
    () => [
      {
        accessorKey: "name",
        header: "اسم المخزن",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 font-medium">
            <Building2 className="h-4 w-4 text-slate-400" />
            {row.original.name}
          </div>
        ),
      },
      { accessorKey: "code", header: "الكود" },
      {
        accessorKey: "phone",
        header: "الهاتف",
        cell: ({ row }) => row.original.phone || "-",
      },
      {
        accessorKey: "address",
        header: "العنوان",
        cell: ({ row }) => row.original.address || "-",
      },
      {
        accessorKey: "isActive",
        header: "الحالة",
        cell: ({ row }) => (
          row.original.isActive ? (
            <Badge variant="success">مفعل</Badge>
          ) : (
            <Badge variant="secondary">مغلق</Badge>
          )
        ),
      },
      {
        id: "actions",
        header: "الإجراءات",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate(`/branches/${row.original.id}`)}>
              <Eye className="h-4 w-4" /> فتح
            </Button>
            <Button variant="outline" onClick={() => startEdit(row.original)}>
              <Edit className="h-4 w-4" />
              تعديل
            </Button>
            <Button
              variant={row.original.isActive ? "destructive" : "secondary"}
              onClick={() =>
                updateBranch(row.original.id, { isActive: !row.original.isActive }).then(() => {
                  queryClient.invalidateQueries({ queryKey: ["branches"] })
                  queryClient.invalidateQueries({ queryKey: ["branches", "summaries"] })
                })
              }
            >
              {row.original.isActive ? "تعطيل" : "تفعيل"}
            </Button>
          </div>
        ),
      },
    ],
    [queryClient],
  )

  const table = useReactTable({
    data: branchesQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function startCreate() {
    setEditingBranch(null)
    setForm(emptyForm)
    setOpen(true)
  }

  function startEdit(branch: Branch) {
    setEditingBranch(branch)
    setForm({
      name: branch.name,
      code: branch.code,
      phone: branch.phone ?? "",
      address: branch.address ?? "",
      isActive: branch.isActive,
    })
    setOpen(true)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    saveBranch.mutate({
      ...form,
      name: form.name.trim(),
      code: form.code.trim(),
      phone: form.phone?.trim() || undefined,
      address: form.address?.trim() || undefined,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">إدارة المخازن</h1>
          <p className="text-slate-500">تعريف المخازن وربط العمليات المالية والمخزنية بكل مخزن.</p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="h-4 w-4" />
          مخزن جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الفلاتر</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_180px_120px]">
          <Input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="بحث بالاسم أو الكود"
          />
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value as "all" | "active" | "inactive")}
          >
            <option value="all">كل المخازن</option>
            <option value="active">المفعلة فقط</option>
            <option value="inactive">المعطلة فقط</option>
          </select>
          <Button onClick={() => setSearch(searchDraft)}>
            <Search className="h-4 w-4" />
            بحث
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {(summariesQuery.data ?? []).map((summary) => (
          <Card key={summary.branch.id} className="cursor-pointer border-t-4 border-t-sky-500 transition hover:border-t-sky-600 hover:shadow-md" onClick={() => navigate(`/branches/${summary.branch.id}`)}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold">{summary.branch.name}</div>
                  <div className="text-xs text-slate-500">{summary.branch.code}</div>
                </div>
                <Badge variant={summary.branch.isActive ? "success" : "secondary"}>
                  {summary.branch.isActive ? "فعال" : "مغلق"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <BranchMetric label="مبيعات" value={summary.sales.total} />
                <BranchMetric label="مقبوض" value={summary.vouchers.receipts} good />
                <BranchMetric label="باقي" value={summary.sales.remaining} danger={summary.sales.remaining > 0} />
                <BranchMetric label="مصروف" value={summary.vouchers.expenses} danger={summary.vouchers.expenses > 0} />
                <BranchMetric label="زبائن" value={summary.customers} plain />
                <BranchMetric label="مواد" value={summary.products} plain />
              </div>
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                تحويلات: داخل {summary.transfers.in} | خارج {summary.transfers.out} | منخفض المخزون {summary.stock.lowStock}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            المخازن
            <Badge className="bg-slate-900">{branchesQuery.data?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              {table.getHeaderGroups().map((headerGroup) => (
                <TR key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TH key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TH>
                  ))}
                </TR>
              ))}
            </THead>
            <TBody>
              {table.getRowModel().rows.map((row) => (
                <TR key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>
                  ))}
                </TR>
              ))}
              {table.getRowModel().rows.length === 0 ? (
                <TR>
                  <TD colSpan={columns.length} className="py-8 text-center text-slate-500">
                    لا توجد مخازن مطابقة.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <ModalForm open={open} onOpenChange={setOpen} title={editingBranch ? "تعديل مخزن" : "مخزن جديد"}>
        <form className="space-y-3" onSubmit={submit}>
          <Input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="اسم المخزن"
          />
          <Input
            required
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            placeholder="كود المخزن"
          />
          <Input
            value={form.phone ?? ""}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="الهاتف"
          />
          <Input
            value={form.address ?? ""}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
            placeholder="العنوان"
          />
          <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            مخزن فعال
          </label>
          <Button className="w-full" type="submit" disabled={saveBranch.isPending}>
            حفظ
          </Button>
        </form>
      </ModalForm>
    </div>
  )
}

function BranchMetric({
  label,
  value,
  good,
  danger,
  plain,
}: {
  label: string
  value: number
  good?: boolean
  danger?: boolean
  plain?: boolean
}) {
  return (
    <div className="rounded-md border border-slate-100 bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={plain ? "font-bold" : good ? "font-bold text-emerald-600" : danger ? "font-bold text-rose-600" : "font-bold text-slate-900"}>
        {plain ? value : value.toLocaleString()}
      </div>
    </div>
  )
}
