import { useMemo, useState, type FormEvent } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Plus } from "lucide-react"
import { useUsers } from "../hooks/useUsers"
import type { CreateUserPayload, Role, User } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

export function UsersPage() {
  const { usersQuery, createMutation, roleMutation, deactivateMutation } = useUsers()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CreateUserPayload>({
    name: "",
    username: "",
    password: "",
    role: "STAFF",
    isActive: true,
  })

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      { accessorKey: "name", header: "الاسم" },
      { accessorKey: "username", header: "اسم المستخدم" },
      {
        accessorKey: "role",
        header: "الدور",
        cell: ({ row }) => (
          <button
            className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
            onClick={() =>
              roleMutation.mutate({
                user: row.original,
                role: row.original.role === "ADMIN" ? "STAFF" : "ADMIN",
              })
            }
          >
            {row.original.role}
          </button>
        ),
      },
      {
        accessorKey: "isActive",
        header: "الحالة",
        cell: ({ row }) =>
          row.original.isActive ? (
            <span className="text-emerald-600">فعال</span>
          ) : (
            <span className="text-slate-400">معطل</span>
          ),
      },
      {
        id: "actions",
        header: "الإجراءات",
        cell: ({ row }) => (
          <Button
            variant="outline"
            disabled={!row.original.isActive}
            onClick={() => deactivateMutation.mutate(row.original.id)}
          >
            تعطيل
          </Button>
        ),
      },
    ],
    [deactivateMutation, roleMutation],
  )

  const table = useReactTable({
    data: usersQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    createMutation.mutate(form, {
      onSuccess: () => {
        setOpen(false)
        setForm({ name: "", username: "", password: "", role: "STAFF", isActive: true })
      },
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">إدارة المستخدمين</h1>
          <p className="text-slate-500">إدارة الصلاحيات وتعطيل الحسابات.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          مستخدم جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            المستخدمون
            <Badge className="bg-slate-900">{usersQuery.data?.length ?? 0}</Badge>
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
                    <TD key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <ModalForm open={open} onOpenChange={setOpen} title="مستخدم جديد">
        <form className="space-y-3" onSubmit={submit}>
          <Input placeholder="الاسم" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input placeholder="اسم المستخدم" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <Input placeholder="كلمة المرور" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
          >
            <option value="STAFF">STAFF</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <Button className="w-full" type="submit" disabled={createMutation.isPending}>
            حفظ
          </Button>
        </form>
      </ModalForm>
    </div>
  )
}
