import { useMemo, useState, type FormEvent } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Building2, Edit, Plus, Search } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createBranch, getBranches, updateBranch } from "../api/endpoints"
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

  const saveBranch = useMutation({
    mutationFn: (payload: BranchPayload) =>
      editingBranch ? updateBranch(editingBranch.id, payload) : createBranch(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branches"] })
      setOpen(false)
      setEditingBranch(null)
      setForm(emptyForm)
    },
  })

  const columns = useMemo<ColumnDef<Branch>[]>(
    () => [
      {
        accessorKey: "name",
        header: "اسم الفرع",
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
            <Button variant="outline" onClick={() => startEdit(row.original)}>
              <Edit className="h-4 w-4" />
              تعديل
            </Button>
            <Button
              variant={row.original.isActive ? "destructive" : "secondary"}
              onClick={() =>
                updateBranch(row.original.id, { isActive: !row.original.isActive }).then(() =>
                  queryClient.invalidateQueries({ queryKey: ["branches"] }),
                )
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
          <h1 className="text-2xl font-bold">إدارة الفروع</h1>
          <p className="text-slate-500">تعريف الفروع وربط العمليات المالية والمخزنية بكل فرع.</p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="h-4 w-4" />
          فرع جديد
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
            <option value="all">كل الفروع</option>
            <option value="active">الفعالة فقط</option>
            <option value="inactive">المعطلة فقط</option>
          </select>
          <Button onClick={() => setSearch(searchDraft)}>
            <Search className="h-4 w-4" />
            بحث
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            الفروع
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
                    لا توجد فروع مطابقة.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <ModalForm open={open} onOpenChange={setOpen} title={editingBranch ? "تعديل فرع" : "فرع جديد"}>
        <form className="space-y-3" onSubmit={submit}>
          <Input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="اسم الفرع"
          />
          <Input
            required
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            placeholder="كود الفرع"
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
            فرع فعال
          </label>
          <Button className="w-full" type="submit" disabled={saveBranch.isPending}>
            حفظ
          </Button>
        </form>
      </ModalForm>
    </div>
  )
}
