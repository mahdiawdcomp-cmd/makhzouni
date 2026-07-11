import { useMemo, useState, type FormEvent } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { CheckCircle2, Edit, Plus, Trash2 } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createPersonalDebt,
  deletePersonalDebt,
  getPersonalDebts,
  markPersonalDebtPaid,
  updatePersonalDebt,
} from "../api/endpoints"
import { useSettings, useUpdateSettings } from "../hooks/useSettings"
import type { CreatePersonalDebtPayload, PersonalDebt, PersonalDebtStatus } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { apiErrorMessage } from "../utils/apiError"

const emptyForm: CreatePersonalDebtPayload = {
  personName: "",
  amount: 0,
  dueDate: new Date().toISOString().slice(0, 10),
  notes: "",
}

const statusBadge: Record<PersonalDebtStatus, { label: string; variant: "info" | "danger" | "success" }> = {
  PENDING: { label: "مستحق", variant: "info" },
  OVERDUE: { label: "متأخر", variant: "danger" },
  PAID: { label: "مسدد", variant: "success" },
}

// «الديون الشخصية» — ديون شخصية ماله علاقة بزبائن المحل، مثل فلوس أنطيتها
// لصديق. تنبيه الموقع + الواتساب يتكرر يوميًا من runPersonalDebtReminderJob
// بالباك اند لحد ما يتسدد الدين.
export function PersonalDebtsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editingDebt, setEditingDebt] = useState<PersonalDebt | null>(null)
  const [form, setForm] = useState<CreatePersonalDebtPayload>(emptyForm)
  const [reminderPhoneDraft, setReminderPhoneDraft] = useState<string | null>(null)

  const debtsQuery = useQuery({
    queryKey: ["personal-debts"],
    queryFn: getPersonalDebts,
  })

  const settingsQuery = useSettings()
  const updateSettingsMutation = useUpdateSettings()
  const reminderPhone = reminderPhoneDraft ?? settingsQuery.data?.personalDebtReminderWhatsappNumber ?? ""

  const saveDebt = useMutation({
    mutationFn: (payload: CreatePersonalDebtPayload) =>
      editingDebt ? updatePersonalDebt(editingDebt.id, payload) : createPersonalDebt(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-debts"] })
      setOpen(false)
      setEditingDebt(null)
      setForm(emptyForm)
    },
  })

  const markPaid = useMutation({
    mutationFn: (id: string) => markPersonalDebtPaid(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-debts"] }),
  })

  const removeDebt = useMutation({
    mutationFn: (id: string) => deletePersonalDebt(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-debts"] }),
  })

  const columns = useMemo<ColumnDef<PersonalDebt>[]>(
    () => [
      { accessorKey: "personName", header: "الاسم" },
      {
        accessorKey: "amount",
        header: "المبلغ",
        cell: ({ row }) => <span className="font-bold">{Number(row.original.amount).toLocaleString()}</span>,
      },
      {
        accessorKey: "dueDate",
        header: "موعد الاستلام",
        cell: ({ row }) => new Date(row.original.dueDate).toLocaleDateString(),
      },
      {
        accessorKey: "computedStatus",
        header: "الحالة",
        cell: ({ row }) => {
          const info = statusBadge[row.original.computedStatus]
          return <Badge variant={info.variant}>{info.label}</Badge>
        },
      },
      {
        accessorKey: "notes",
        header: "ملاحظات",
        cell: ({ row }) => row.original.notes || "-",
      },
      {
        id: "actions",
        header: "الإجراءات",
        cell: ({ row }) => {
          const debt = row.original
          return (
            <div className="flex flex-wrap gap-2">
              {debt.status !== "PAID" ? (
                <Button variant="outline" disabled={markPaid.isPending} onClick={() => markPaid.mutate(debt.id)}>
                  <CheckCircle2 className="h-4 w-4" /> تم الاستلام
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => startEdit(debt)}>
                <Edit className="h-4 w-4" /> تعديل
              </Button>
              <Button
                variant="destructive"
                disabled={removeDebt.isPending}
                onClick={() => {
                  if (confirm(`حذف دين ${debt.personName}؟`)) removeDebt.mutate(debt.id)
                }}
              >
                <Trash2 className="h-4 w-4" /> حذف
              </Button>
            </div>
          )
        },
      },
    ],
    [markPaid, removeDebt],
  )

  const table = useReactTable({
    data: debtsQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function startCreate() {
    setEditingDebt(null)
    setForm(emptyForm)
    setOpen(true)
  }

  function startEdit(debt: PersonalDebt) {
    setEditingDebt(debt)
    setForm({
      personName: debt.personName,
      amount: Number(debt.amount),
      dueDate: debt.dueDate.slice(0, 10),
      notes: debt.notes ?? "",
    })
    setOpen(true)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    saveDebt.mutate({
      ...form,
      personName: form.personName.trim(),
      notes: form.notes?.trim() || undefined,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الديون الشخصية</h1>
          <p className="text-slate-500">فلوس شخصية أنطيتها لناس — ماله علاقة بزبائن المحل أو حساباته.</p>
        </div>
        <Button onClick={startCreate}>
          <Plus className="h-4 w-4" />
          دين جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>رقم واتساب التذكير</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_140px]">
          <Input
            value={reminderPhone}
            onChange={(event) => setReminderPhoneDraft(event.target.value)}
            placeholder="مثال: 9647xxxxxxxxx"
          />
          <Button
            disabled={updateSettingsMutation.isPending}
            onClick={() =>
              updateSettingsMutation.mutate(
                { personalDebtReminderWhatsappNumber: reminderPhone.trim() },
                { onSuccess: () => setReminderPhoneDraft(null) },
              )
            }
          >
            حفظ الرقم
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            الديون
            <Badge className="bg-slate-900">{debtsQuery.data?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {saveDebt.isError ? (
            <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {apiErrorMessage(saveDebt.error)}
            </div>
          ) : null}
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
                    لا توجد ديون شخصية مسجلة.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <ModalForm open={open} onOpenChange={setOpen} title={editingDebt ? "تعديل دين" : "دين جديد"}>
        <form className="space-y-3" onSubmit={submit}>
          <Input
            required
            value={form.personName}
            onChange={(event) => setForm({ ...form, personName: event.target.value })}
            placeholder="اسم الشخص"
          />
          <Input
            required
            type="number"
            min={0}
            step="0.01"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })}
            placeholder="المبلغ"
          />
          <Input
            required
            type="date"
            value={form.dueDate}
            onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
          />
          <Input
            value={form.notes ?? ""}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="ملاحظات (اختياري)"
          />
          <Button className="w-full" type="submit" disabled={saveDebt.isPending}>
            حفظ
          </Button>
        </form>
      </ModalForm>
    </div>
  )
}
