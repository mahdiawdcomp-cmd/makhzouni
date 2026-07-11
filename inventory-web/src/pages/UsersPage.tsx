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
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { toast } from "../components/ui/use-toast"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

type UserForm = CreateUserPayload & { id?: string; password: string }

const allPermissions: Array<{ id: UserPermission; label: string; hint: string; group?: string }> = [
  { id: "MANAGE_USERS",        label: "المستخدمين",        hint: "إضافة وتعديل وتعطيل المستخدمين" },
  { id: "MANAGE_APPROVALS",    label: "الموافقات",          hint: "مراجعة طلبات الموظفين" },
  { id: "MANAGE_PRODUCTS",     label: "المخزن",             hint: "إضافة وتعديل المواد" },
  { id: "MANAGE_CUSTOMERS",    label: "الزبائن والموردين", hint: "إدارة الحسابات والكشوفات" },
  { id: "MANAGE_INVOICES",     label: "الفواتير",           hint: "إنشاء وتعديل فواتير البيع والشراء" },
  { id: "MANAGE_VOUCHERS",     label: "السندات",            hint: "سندات القبض والدفع والمصاريف" },
  { id: "VIEW_REPORTS",        label: "التقارير",           hint: "عرض تقارير المبيعات والأرباح" },
  { id: "MANAGE_SETTINGS",     label: "الإعدادات",          hint: "إعدادات النظام والرسائل" },
  // Granular sell-floor permissions
  { id: "VIEW_WITHOUT_PRICES", label: "عرض بدون أسعار",    hint: "يرى المواد لكن بدون أسعار البيع والشراء", group: "sell" },
  { id: "SELL_WITH_DISCOUNT",  label: "السماح بالخصم",     hint: "يمكنه تطبيق خصومات عند إنشاء الفواتير", group: "sell" },
  { id: "VIEW_PURCHASE_PRICE", label: "عرض سعر الشراء",    hint: "يرى سعر الشراء للمواد", group: "sell" },
  { id: "ACCESS_POS",          label: "نقطة البيع فقط",    hint: "صلاحية استخدام الكاشير المبسط فقط", group: "sell" },
  // Warehouse transfers / stocktake
  { id: "REQUEST_TRANSFER",    label: "طلب تحويل",          hint: "يدخل صفحة التحويل ويرسل طلب نقل بين المخازن", group: "transfer" },
  { id: "MANAGE_TRANSFERS",    label: "إدارة المخزن (قبول التحويلات)", hint: "يقبل أو يرفض طلبات التحويل بين المخازن", group: "transfer" },
  { id: "INVENTORY_MANAGE",    label: "جرد المخزون",        hint: "يفتح ويدير جلسات الجرد (الستوكتيك)", group: "transfer" },
  { id: "VARIETY_CONVERT",     label: "تحويل الصنف",        hint: "صلاحية محدودة لصفحة تحويل الأصناف بدون رؤية الأسعار", group: "transfer" },
  { id: "ACCESS_WHATSAPP_CHAT", label: "محادثات الواتساب",  hint: "يفتح شاشة الواتساب ويرسل ويستقبل رسائل باسم المحل" },
]

const fullPermissions = allPermissions.map((permission) => permission.id)

// DENY marker (not a normal grant, so intentionally NOT in allPermissions): when
// present it hides profit & financial reports even from a full ADMIN. The toggle below
// is the ONLY per-account control that stays editable for admins.
const HIDE_PROFIT: UserPermission = "HIDE_PROFIT_REPORTS"
const isProfitHidden = (perms: UserPermission[] | undefined) => (perms ?? []).includes(HIDE_PROFIT)

const emptyForm: UserForm = {
  name: "",
  username: "",
  password: "",
  role: "STAFF",
  permissions: [],
  phone: "",
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
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<User | null>(null)

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
      // Admins are shown as holding every grant, but we must preserve the profit DENY
      // marker if it was set on this account (fullPermissions doesn't carry it).
      permissions:
        user.role === "ADMIN"
          ? [...fullPermissions, ...(isProfitHidden(user.permissions) ? [HIDE_PROFIT] : [])]
          : user.permissions ?? [],
      phone: user.phone ?? "",
      isActive: user.isActive,
    })
    setError("")
    setOpen(true)
  }

  function setRole(role: Role) {
    const profitHidden = isProfitHidden(form.permissions)
    setForm({
      ...form,
      role,
      // Switching to ADMIN grants everything but must keep the profit DENY marker if set.
      permissions:
        role === "ADMIN"
          ? [...fullPermissions, ...(profitHidden ? [HIDE_PROFIT] : [])]
          : form.permissions,
    })
  }

  function togglePermission(permission: UserPermission) {
    const current = new Set(form.permissions ?? [])
    if (current.has(permission)) current.delete(permission)
    else current.add(permission)
    setForm({ ...form, permissions: Array.from(current) })
  }

  // Editable even for ADMIN. checked = can view profits (= marker absent).
  function toggleProfitVisibility() {
    const current = new Set(form.permissions ?? [])
    if (current.has(HIDE_PROFIT)) current.delete(HIDE_PROFIT)
    else current.add(HIDE_PROFIT)
    setForm({ ...form, permissions: Array.from(current) })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    // Admins get every grant; both roles additionally carry the profit DENY marker when set.
    const profitHidden = isProfitHidden(form.permissions)
    const basePermissions = form.role === "ADMIN" ? fullPermissions : form.permissions ?? []
    const permissions = Array.from(
      new Set<UserPermission>([...basePermissions, ...(profitHidden ? [HIDE_PROFIT] : [])]),
    )
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
            phone: form.phone?.trim() || null,
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
    setConfirmDeleteUser(user)
  }

  function doDelete(user: User) {
    setConfirmDeleteUser(null)
    deleteMutation.mutate(user.id, {
      onError: (err) => {
        const message =
          (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ??
          (err as Error).message ??
          "تعذر حذف المستخدم"
        toast({ title: message, variant: "destructive" })
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
            <Input
              placeholder="رقم الواتساب (اختياري — للإشعارات)"
              value={form.phone ?? ""}
              inputMode="tel"
              dir="ltr"
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
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
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">الصلاحيات الرئيسية</span>
              <button
                type="button"
                disabled={form.role === "ADMIN"}
                onClick={() => setForm({ ...form, permissions: ["VIEW_WITHOUT_PRICES", "REQUEST_TRANSFER"] })}
                className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                title="عرض بدون أسعار + طلب تحويل فقط — بدون أي صلاحية مالية أو إدارية"
              >
                🧰 حساب عامل مخزن
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {allPermissions.filter((p) => !p.group).map((permission) => {
                const checked = form.role === "ADMIN" || (form.permissions ?? []).includes(permission.id)
                return (
                  <label key={permission.id} className="flex gap-3 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <input type="checkbox" checked={checked} disabled={form.role === "ADMIN"} onChange={() => togglePermission(permission.id)} />
                    <span>
                      <span className="block font-medium">{permission.label}</span>
                      <span className="block text-xs text-slate-500">{permission.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="my-3 border-t border-slate-200 dark:border-slate-700" />
            <div className="mb-2 text-sm font-semibold text-slate-600">صلاحيات المبيعات التفصيلية</div>
            <div className="grid gap-2 md:grid-cols-2">
              {allPermissions.filter((p) => p.group === "sell").map((permission) => {
                const checked = form.role === "ADMIN" || (form.permissions ?? []).includes(permission.id)
                return (
                  <label key={permission.id} className="flex gap-3 rounded-md border border-amber-100 bg-amber-50/50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                    <input type="checkbox" checked={checked} disabled={form.role === "ADMIN"} onChange={() => togglePermission(permission.id)} />
                    <span>
                      <span className="block font-medium">{permission.label}</span>
                      <span className="block text-xs text-slate-500">{permission.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="my-3 border-t border-slate-200 dark:border-slate-700" />
            <div className="mb-2 text-sm font-semibold text-slate-600">صلاحيات المخازن والتحويلات</div>
            <div className="grid gap-2 md:grid-cols-2">
              {allPermissions.filter((p) => p.group === "transfer").map((permission) => {
                const checked = form.role === "ADMIN" || (form.permissions ?? []).includes(permission.id)
                return (
                  <label key={permission.id} className="flex gap-3 rounded-md border border-sky-100 bg-sky-50/50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                    <input type="checkbox" checked={checked} disabled={form.role === "ADMIN"} onChange={() => togglePermission(permission.id)} />
                    <span>
                      <span className="block font-medium">{permission.label}</span>
                      <span className="block text-xs text-slate-500">{permission.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            {form.role === "ADMIN" ? (
              <div className="mt-2 text-xs text-slate-500">المدير الكامل يحصل على كل الصلاحيات تلقائياً — عدا التحكم بالأرباح أدناه.</div>
            ) : null}

            <div className="my-3 border-t border-slate-200 dark:border-slate-700" />
            <div className="mb-2 text-sm font-semibold text-slate-600">الأرباح والتقارير المالية</div>
            <label className="flex gap-3 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-900/20">
              <input
                type="checkbox"
                checked={!isProfitHidden(form.permissions)}
                onChange={toggleProfitVisibility}
              />
              <span>
                <span className="block font-medium">عرض الأرباح والتقارير المالية</span>
                <span className="block text-xs text-slate-500">
                  عند التعطيل يُخفى قسم الأرباح وعقل المحل والتقارير المالية عن هذا الحساب — حتى لو كان مديراً كاملاً.
                </span>
              </span>
            </label>
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

      <ConfirmDialog
        open={confirmDeleteUser !== null}
        title="حذف المستخدم نهائياً؟"
        description="المستخدم راح يُحذف من القائمة. اسمه يبقى على الفواتير والسندات القديمة."
        confirmLabel="حذف"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDeleteUser && doDelete(confirmDeleteUser)}
        onCancel={() => setConfirmDeleteUser(null)}
      />
    </div>
  )
}
