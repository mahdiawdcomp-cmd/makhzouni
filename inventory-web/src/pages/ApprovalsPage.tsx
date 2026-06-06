import { useMemo, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Check, Copy, ExternalLink, Eye, ShoppingCart, X } from "lucide-react"
import { useApprovals } from "../hooks/useApprovals"
import type { Approval } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { apiErrorMessage } from "../utils/apiError"

type ApprovalData = {
  source?: string
  customerName?: string
  phone?: string
  address?: string
  notes?: string
  subtotal?: number
  displayItems?: Array<{
    productId: string
    productName: string
    unit: string
    quantity: number
    unitPrice: number
    totalPrice: number
  }>
  body?: unknown
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("en-US")
}

function unitLabel(unit: string) {
  if (unit === "CARTON") return "كارتون"
  if (unit === "DOZEN") return "درزن"
  return "قطعة"
}

function requestTypeLabel(type: string) {
  const labels: Record<string, string> = {
    CATALOG_ORDER: "طلب كتالوج",
    CREATE_USER: "إضافة مستخدم",
    UPDATE_USER: "تعديل مستخدم",
    DEACTIVATE_USER: "تعطيل مستخدم",
    CREATE_CUSTOMER: "إضافة زبون",
    UPDATE_CUSTOMER: "تعديل زبون",
    DELETE_CUSTOMER: "حذف زبون",
    CREATE_PRODUCT: "إضافة مادة",
    UPDATE_PRODUCT: "تعديل مادة",
    DELETE_PRODUCT: "حذف مادة",
    CREATE_INVOICE: "إضافة فاتورة",
    UPDATE_INVOICE: "تعديل فاتورة",
    CANCEL_INVOICE: "إلغاء فاتورة",
    CREATE_VOUCHER: "إضافة سند",
    UPDATE_VOUCHER: "تعديل سند",
    DELETE_VOUCHER: "حذف سند",
  }
  return labels[type] ?? type
}

function approvalData(approval: Approval | null): ApprovalData {
  return (approval?.requestData && typeof approval.requestData === "object" ? approval.requestData : {}) as ApprovalData
}

export function ApprovalsPage() {
  const { approvalsQuery, reviewMutation } = useApprovals()
  const [selected, setSelected] = useState<Approval | null>(null)
  const [allowPricesById, setAllowPricesById] = useState<Record<string, boolean>>({})
  const [showStockById, setShowStockById] = useState<Record<string, boolean>>({})
  const rows = approvalsQuery.data ?? []
  const catalogUrl = `${window.location.origin}/catalog`

  const columns = useMemo<ColumnDef<Approval>[]>(
    () => [
      {
        accessorKey: "requestType",
        header: "نوع الطلب",
        cell: ({ row }) => requestTypeLabel(row.original.requestType),
      },
      {
        id: "summary",
        header: "الملخص",
        cell: ({ row }) => {
          const data = approvalData(row.original)
          if (row.original.requestType === "CATALOG_ORDER") {
            return (
              <div className="space-y-0.5">
                <div className="font-semibold">{data.customerName ?? "-"}</div>
                <div className="text-xs text-slate-500">
                  {data.phone ?? "-"} - {money(data.subtotal)} د.ع
                </div>
              </div>
            )
          }
          if (row.original.requestType === "CATALOG_ACCESS") {
            return (
              <div className="space-y-0.5">
                <div className="font-semibold">{data.customerName ?? "-"}</div>
                <div className="text-xs text-slate-500">
                  {data.phone ?? "-"} - طلب دخول كتالوج
                </div>
              </div>
            )
          }
          return row.original.requester?.name ?? row.original.requestedBy
        },
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
            {row.original.requestType === "CATALOG_ACCESS" && (
              <div className="flex flex-col gap-1 text-xs">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={Boolean(allowPricesById[row.original.id])} onChange={e => setAllowPricesById(p => ({ ...p, [row.original.id]: e.target.checked }))} />
                  أسعار
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={showStockById[row.original.id] !== false} onChange={e => setShowStockById(p => ({ ...p, [row.original.id]: e.target.checked }))} />
                  كميات
                </label>
              </div>
            )}
            <Button
              disabled={reviewMutation.isPending}
              onClick={() =>
                reviewMutation.mutate({
                  id: row.original.id,
                  status: "APPROVED",
                  allowPrices: row.original.requestType === "CATALOG_ACCESS" ? Boolean(allowPricesById[row.original.id]) : undefined,
                  showStock: row.original.requestType === "CATALOG_ACCESS" ? (showStockById[row.original.id] !== false) : undefined,
                })
              }
            >
              <Check className="h-4 w-4" />
              وافق
            </Button>
            <Button
              variant="destructive"
              disabled={reviewMutation.isPending}
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
    [allowPricesById, showStockById, reviewMutation],
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
        <p className="text-slate-500">طلبات معلقة تنتظر موافقة الإدارة قبل تنفيذها.</p>
      </div>
      <CatalogLinkCard catalogUrl={catalogUrl} />
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
                    <TH key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TH>
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
              {!approvalsQuery.isLoading && rows.length === 0 ? (
                <TR>
                  <TD colSpan={columns.length} className="py-8 text-center text-slate-500">
                    لا توجد طلبات معلقة
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {reviewMutation.isError ? (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {apiErrorMessage(reviewMutation.error, "تعذر تنفيذ الموافقة")}
        </div>
      ) : null}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selected ? requestTypeLabel(selected.requestType) : "تفاصيل الطلب"}</DialogTitle>
          </DialogHeader>
          <ApprovalDetails
            approval={selected}
            allowPrices={selected ? Boolean(allowPricesById[selected.id]) : false}
            onAllowPricesChange={(value) => {
              if (!selected) return
              setAllowPricesById((prev) => ({ ...prev, [selected.id]: value }))
            }}
            onApprove={() => {
              if (!selected) return
              reviewMutation.mutate({
                id: selected.id,
                status: "APPROVED",
                allowPrices: selected.requestType === "CATALOG_ACCESS" ? Boolean(allowPricesById[selected.id]) : undefined,
              })
              setSelected(null)
            }}
            approving={reviewMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CatalogLinkCard({ catalogUrl }: { catalogUrl: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="font-semibold">رابط الكاتلوگ للزبائن</div>
          <div className="break-all text-sm text-slate-500">{catalogUrl}</div>
          <div className="mt-1 text-xs text-slate-500">
            الزبون يفتح الرابط ويرسل الاسم والرقم والعنوان، بعدها يظهر طلبه هنا وتوافق عليه وتحدد يشوف الأسعار أو لا.
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={() => void navigator.clipboard?.writeText(catalogUrl)}>
            <Copy className="h-4 w-4" />
            نسخ
          </Button>
          <Button type="button" variant="outline" onClick={() => window.open(catalogUrl, "_blank", "noopener,noreferrer")}>
            <ExternalLink className="h-4 w-4" />
            فتح
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ApprovalDetails({
  approval,
  allowPrices,
  onAllowPricesChange,
  onApprove,
  approving,
}: {
  approval: Approval | null
  allowPrices: boolean
  onAllowPricesChange: (value: boolean) => void
  onApprove: () => void
  approving: boolean
}) {
  const data = approvalData(approval)
  if (approval?.requestType === "CATALOG_ACCESS") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <Info label="الزبون" value={data.customerName} />
          <Info label="الهاتف" value={data.phone} />
          <Info label="العنوان" value={data.address || "-"} />
          {data.notes ? <Info label="ملاحظات" value={data.notes} wide /> : null}
        </div>
        <label className="flex items-center justify-between rounded-lg border bg-white p-4">
          <span>
            <span className="block font-semibold">السماح بعرض الأسعار</span>
            <span className="text-xs text-slate-500">إذا غير مفعّل، الزبون يشوف المنتجات والصور بدون أسعار.</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={allowPrices}
            onChange={(event) => onAllowPricesChange(event.target.checked)}
          />
        </label>
        <Button className="w-full" disabled={approving} onClick={onApprove}>
          <Check className="h-4 w-4" />
          وافق وافتح الكتالوج
        </Button>
      </div>
    )
  }
  if (approval?.requestType === "CATALOG_ORDER") {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <Info label="الزبون" value={data.customerName} />
          <Info label="الهاتف" value={data.phone} />
          <Info label="العنوان" value={data.address || "-"} />
          <Info label="المجموع" value={`${money(data.subtotal)} د.ع`} />
          {data.notes ? <Info label="ملاحظات" value={data.notes} wide /> : null}
        </div>
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-white px-4 py-3 font-semibold">
            <ShoppingCart className="h-4 w-4 text-emerald-600" />
            مواد الطلب
          </div>
          <div className="max-h-[45vh] overflow-auto">
            <Table>
              <THead>
                <TR>
                  <TH>المادة</TH>
                  <TH>الوحدة</TH>
                  <TH>العدد</TH>
                  <TH>السعر</TH>
                  <TH>المجموع</TH>
                </TR>
              </THead>
              <TBody>
                {(data.displayItems ?? []).map((item) => (
                  <TR key={`${item.productId}-${item.unit}`}>
                    <TD className="font-semibold">{item.productName}</TD>
                    <TD>{unitLabel(item.unit)}</TD>
                    <TD>{money(item.quantity)}</TD>
                    <TD>{money(item.unitPrice)} د.ع</TD>
                    <TD className="font-bold">{money(item.totalPrice)} د.ع</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-950 p-4 text-left text-xs text-slate-100" dir="ltr">
      {JSON.stringify(approval?.requestData, null, 2)}
    </pre>
  )
}

function Info({ label, value, wide }: { label: string; value?: string | number | null; wide?: boolean }) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold">{value ?? "-"}</div>
    </div>
  )
}
