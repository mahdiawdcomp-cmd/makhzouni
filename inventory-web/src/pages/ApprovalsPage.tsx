import { useMemo, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Check, Eye, X } from "lucide-react"
import { useApprovals } from "../hooks/useApprovals"
import type { Approval } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

export function ApprovalsPage() {
  const { approvalsQuery, reviewMutation } = useApprovals()
  const [selected, setSelected] = useState<Approval | null>(null)
  const rows = approvalsQuery.data ?? []

  const columns = useMemo<ColumnDef<Approval>[]>(
    () => [
      { accessorKey: "requestType", header: "نوع الطلب" },
      {
        id: "requester",
        header: "من",
        cell: ({ row }) => row.original.requester?.name ?? row.original.requestedBy,
      },
      {
        accessorKey: "createdAt",
        header: "التاريخ",
        cell: ({ row }) => row.original.createdAt?.slice(0, 10) ?? "-",
      },
      {
        id: "details",
        header: "التفاصيل",
        cell: ({ row }) => (
          <Button variant="outline" onClick={() => setSelected(row.original)}>
            <Eye className="h-4 w-4" />
            عرض
          </Button>
        ),
      },
      {
        id: "actions",
        header: "الإجراء",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button
              onClick={() => reviewMutation.mutate({ id: row.original.id, status: "APPROVED" })}
            >
              <Check className="h-4 w-4" />
              وافق
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("هل أنت متأكد من رفض الطلب؟")) {
                  reviewMutation.mutate({ id: row.original.id, status: "REJECTED" })
                }
              }}
            >
              <X className="h-4 w-4" />
              ارفض
            </Button>
          </div>
        ),
      },
    ],
    [reviewMutation],
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">الموافقات</h1>
        <p className="text-slate-500">طلبات STAFF المعلقة قبل تنفيذها.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            الطلبات المعلقة
            <Badge>{rows.length}</Badge>
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

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>تفاصيل الطلب</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-950 p-4 text-left text-xs text-slate-100" dir="ltr">
            {JSON.stringify(selected?.requestData, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
