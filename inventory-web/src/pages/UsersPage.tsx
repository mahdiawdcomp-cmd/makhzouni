import { useMemo, useState, type FormEvent } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Edit, Plus, Trash2, UserX } from "lucide-react"
import { useUsers } from "../hooks/useUsers"
import type { CreateUserPayload, Role, User, UserPermission } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

type UserForm = CreateUserPayload & { id?: string; password: string }

const allPermissions: Array<{ id: UserPermission; label: string; hint: string }> = [
  { id: "MANAGE_USERS", label: "المستخدمين", hint: "إضافة وتعديل وتعطيل المستخدمين" },
  { id: "MANAGE_APPROVALS", label: "الموافقات", hint: "مراجعة طلبات الموظفين" },
  { id: "MANAGE_PRODUCTS", label: "المخزن", hint: "إضافة وتعديل المواد" },
  { id: "MANAGE_CUSTOMERS", label: "الزبائن والموردين", hint: "إدارة الحسابات والكشوفات" },
  { id: "MANAGE_INVOICES", label: "الفواتير", hint: "إنشاء وتعديل فواتير البيع والشراء" },
  { id: "MANAGE_VOUCHERS", label: "السندات", hint: "سندات القبض والدفع والمصاريف" },
  { id: "VIEW_REPORTS", label: "التقارير", hint: "عرض تقارير المبيعات والأرباح" },
  { id: "MANAGE_SETTINGS", label: "الإعدادات", hint: "إعدادات النظام والرسائل" },
]

const fullPermissions = allPermissions.map((permission) => permission.id)

const emptyForm: UserForm = {
  name: "",
  username: "",
  password: "",
  role: "STAFF",
  permissions: [],
  isActive: true,
}

function roleLabel(role: Role) {
  return role === "ADMIN" ? "مدير" : "موظف"
}

function permissionLabel(id: UserPermission) {
  return allPermissions.find((permission) => permission.id === id)?.label ?? id
}

export function UsersPage() {
  const { usersQuery, createMutation, updateMutation, deactivateMutation, deleteMutation } = useUsers()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState<UserForm>(emptyForm)
  const [error, setError] = useState("")

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError("")
    setOpen(true)
  }

  function openEdit(user: User) {
    setEditing(user)
    setForm({
      id: user.id,
      name: user.name,
      username: user.username,
      password: "",
      role: user.role,
      permissions: user.role === "ADMIN" ? fullPermissions : user.permissions ?? [],
      isActive: user.isActive,
    })
    setError("")
    setOpen(true)
  }

  function setRole(role: Role) {
    setForm({
      ...form,
      role,
      permissions: role === "ADMIN" ? fullPermissions : form.permissions,
    })
  }

  function togglePermission(permission: UserPermission) {
    const current = new Set(form.permissions ?? [])
    if (current.has(permission)) current.delete(permission)
    else current.add(permission)
    setForm({ ...form, permissions: Array.from(current) })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    const permissions = form.role === "ADMIN" ? fullPermissions : form.permissions ?? []
    if (!editing && form.password.trim().length < 4) {
      setError("كلمة المرور لازم تكون 4 أحرف على الأقل")
      return
    }
    if (editing && form.password.trim() && form.password.trim().length < 4) {
      setError("كلمة المرور الجديدة لازم تكون 4 أحرف على الأقل")
      return
    }

    if (editing) {
      updateMutation.mutate(
        {
          id: editing.id,
          payload: {
            name: form.name,
            username: form.username,
            role: form.role,
            permissions,
            isActive: form.isActive,
            ...(form.password.trim() ? { password: form.password } : {}),
          },
        },
        {
          onSuccess: () => {
            setOpen(false)
            setEditing(null)
            setForm(emptyForm)
            setError("")
          },
          onError: (err) => setError((err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ?? (err as Error).message ?? "تعذر حفظ المستخدم"),
        },
      )
      return
    }

    createMutation.mutate(
      { ...form, permissions },
      {
        onSuccess: () => {
          setOpen(false)
          setForm(emptyForm)
          setError("")
        },
        onError: (err) => setError((err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ?? (err as Error).message ?? "تعذر إضافة المستخدم"),
      },
    )
  }

  function permanentlyDelete(user: User) {
    const ok = window.confirm("حذف نهائي للمستخدم؟ إذا عنده فواتير أو سندات راح ينرفض الحذف حفاظاً على الحسابات.")
    if (!ok) return

    deleteMutation.mutate(user.id, {
      onError: (err) => {
        const message =
          (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ??
          (err as Error).message ??
          "تعذر حذف المستخدم"
        window.alert(message)
      },
    })
  }

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      { accessorKey: "name", header: "الاسم" },
      { accessorKey: "username", header: "اسم المستخدم" },
      {
        accessorKey: "role",
        header: "الدور",
        cell: ({ row }) => <Badge>{roleLabel(row.original.role)}</Badge>,
      },
      {
        id: "permissions",
        header: "الصلاحيات",
        cell: ({ row }) => {
          const permissions = row.original.role === "ADMIN" ? fullPermissions : row.original.permissions ?? []
          return (
            <div className="flex max-w-xl flex-wrap gap-1">
              {permissions.length === 0 ? (
                <span className="text-xs text-slate-500">بدون صلاحيات محددة</span>
              ) : (
                permissions.map((permission) => (
                  <Badge key={permission} variant="default">{permissionLabel(permission)}</Badge>
                ))
              )}
            </div>
          )
        },
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => openEdit(row.original)}>
              <Edit className="h-4 w-4" /> تعديل
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!row.original.isActive}
              onClick={() => deactivateMutation.mutate(row.original.id)}
            >
              <UserX className="h-4 w-4" /> تعطيل
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-red-200 text-red-600 hover:bg-red-50"
              disabled={deleteMutation.isPending}
              onClick={() => permanentlyDelete(row.original)}
            >
              <Trash2 className="h-4 w-4" /> حذف نهائي
            </Button>
          </div>
        ),
      },
    ],
    [deactivateMutation, deleteMutation],
  )

  const table = useReactTable({
    data: usersQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const saving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold">إدارة المستخدمين</h1>
          <p className="text-slate-500">إضافة المستخدمين وتعديل الحسابات وتحديد الصلاحيات بدقة.</p>
        </div>
        <Button onClick={openCreate}>
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

      <ModalForm open={open} onOpenChange={setOpen} title={editing ? "تعديل مستخدم" : "مستخدم جديد"}>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-3 md:grid-cols-2">
            <Input required placeholder="الاسم" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Input required placeholder="اسم المستخدم" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            <Input
              required={!editing}
              placeholder={editing ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"}
              type="password"
              minLength={editing ? undefined : 4}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
            <select
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              value={form.role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              <option value="STAFF">موظف</option>
              <option value="ADMIN">مدير كامل</option>
            </select>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-3 text-sm font-semibold">الصلاحيات</div>
            <div className="grid gap-2 md:grid-cols-2">
              {allPermissions.map((permission) => {
                const checked = form.role === "ADMIN" || (form.permissions ?? []).includes(permission.id)
                return (
                  <label key={permission.id} className="flex gap-3 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={form.role === "ADMIN"}
                      onChange={() => togglePermission(permission.id)}
                    />
                    <span>
                      <span className="block font-medium">{permission.label}</span>
                      <span className="block text-xs text-slate-500">{permission.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            {form.role === "ADMIN" ? (
              <div className="mt-2 text-xs text-slate-500">المدير الكامل يحصل على كل الصلاحيات تلقائياً.</div>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive ?? true} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            الحساب فعال
          </label>

          <Button className="w-full" type="submit" disabled={saving}>
            حفظ
          </Button>
          {error ? <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}
        </form>
      </ModalForm>
    </div>
  )
}
