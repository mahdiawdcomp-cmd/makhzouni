import { useMemo, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { Check, Copy, ExternalLink, Eye, ShoppingCart, UserPlus, X } from "lucide-react"
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
  customerId?: string
  isFirstOrder?: boolean
  isExistingCustomer?: boolean
  displayItems?: Array<{
    productId: string
    productName: string
    unit: string
    quantity: number
    unitPrice: number
    totalPrice: number
  }>
  // Transfer-request snapshot
  requesterName?: string
  snapshot?: {
    fromName?: string
    toName?: string
    anyExceeds?: boolean
    items?: Array<{
      productName: string
      itemNumber?: string
      unit: string
      quantity: number
      requestedPieces: number
      availablePieces: number
      exceedsStock: boolean
    }>
  }
  // Negative-stock sale snapshot
  invoiceId?: string
  invoiceNumber?: string
  lines?: Array<{
    productName: string
    warehouseName?: string
    quantityPieces: number
    deficitPieces: number
  }>
  body?: unknown
}

// Approval sections shown on the page. Each pending request is routed to a section
// by its requestType; anything unmapped falls into "أخرى".
const APPROVAL_SECTIONS: Array<{ key: string; title: string; types: string[] }> = [
  { key: "negative", title: "بضاعة سالبة (نواقص المخزون)", types: ["NEGATIVE_STOCK_SALE"] },
  { key: "wholesale", title: "كتلوك الجملة", types: ["CATALOG_ACCESS", "CATALOG_ORDER"] },
  { key: "retail", title: "كتلوك المفرد", types: ["RETAIL_ORDER", "RETAIL_ACCESS"] },
  {
    key: "documents",
    title: "الفواتير والسندات",
    types: [
      "CREATE_INVOICE", "UPDATE_INVOICE", "CANCEL_INVOICE", "HARD_DELETE_INVOICE",
      "CREATE_VOUCHER", "UPDATE_VOUCHER", "CANCEL_VOUCHER", "DELETE_VOUCHER", "RESTORE_VOUCHER",
    ],
  },
  {
    key: "data",
    title: "المستخدمين والزبائن والمواد",
    types: [
      "CREATE_USER", "UPDATE_USER", "DEACTIVATE_USER",
      "CREATE_CUSTOMER", "UPDATE_CUSTOMER", "DELETE_CUSTOMER",
      "CREATE_PRODUCT", "UPDATE_PRODUCT", "DELETE_PRODUCT",
    ],
  },
  { key: "transfers", title: "التحويلات بين المخازن", types: ["CREATE_TRANSFER"] },
  { key: "other", title: "أخرى", types: [] },
]

function sectionKeyForType(type: string): string {
  const match = APPROVAL_SECTIONS.find((s) => s.types.includes(type))
  return match ? match.key : "other"
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
    CREATE_TRANSFER: "تحويل بين المخازن",
    NEGATIVE_STOCK_SALE: "بيع بضاعة سالبة",
  }
  return labels[type] ?? type
}

function approvalData(approval: Approval | null): ApprovalData {
  return (approval?.requestData && typeof approval.requestData === "object" ? approval.requestData : {}) as ApprovalData
}

export function ApprovalsPage() {
  const { approvalsQuery, reviewMutation, bulkReviewMutation } = useApprovals()
  const [selected, setSelected] = useState<Approval | null>(null)
  const [allowPricesById, setAllowPricesById] = useState<Record<string, boolean>>({})
  const [showStockById, setShowStockById] = useState<Record<string, boolean>>({})
  const [rejectConfirm, setRejectConfirm] = useState<{ ids: string[]; label: string } | null>(null)
  const rows = approvalsQuery.data ?? []
  const catalogUrl = `${window.location.origin}/catalog`

  function bulkApprove(ids: string[]) {
    bulkReviewMutation.mutate({ ids, status: "APPROVED" })
  }
  function bulkReject(ids: string[], label: string) {
    setRejectConfirm({ ids, label })
  }

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
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">{data.customerName ?? "-"}</span>
                  {data.isFirstOrder && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                      أول طلب
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {data.phone ?? "-"} — {money(data.subtotal)} د.ع
                </div>
              </div>
            )
          }
          if (row.original.requestType === "NEGATIVE_STOCK_SALE") {
            const lines = data.lines ?? []
            return (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">فاتورة {data.invoiceNumber ?? "-"}</span>
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-900 dark:text-rose-300">
                    {lines.length} مادة ناقصة
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {data.customerName ?? row.original.requester?.name ?? "-"}
                </div>
              </div>
            )
          }
          if (row.original.requestType === "CATALOG_ACCESS") {
            return (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">{data.customerName ?? "-"}</span>
                  {data.isExistingCustomer ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                      موجود
                    </span>
                  ) : (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      جديد
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {data.phone ?? "-"} — طلب دخول كتالوج
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
          <div className="flex flex-wrap gap-2">
            {row.original.requestType === "CATALOG_ORDER" && approvalData(row.original).customerId && (
              <Button
                variant="outline"
                onClick={() => window.open(`/customers/${approvalData(row.original).customerId}`, "_blank")}
                title="فتح بروفايل الزبون"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            )}
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
  const allRows = table.getRowModel().rows

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">الموافقات</h1>
        <p className="text-slate-500">طلبات معلقة تنتظر موافقة الإدارة قبل تنفيذها.</p>
      </div>
      <CatalogLinkCard catalogUrl={catalogUrl} />

      {!approvalsQuery.isLoading && rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-slate-500">لا توجد طلبات معلقة</CardContent>
        </Card>
      ) : null}

      {APPROVAL_SECTIONS.map((section) => {
        const sectionRows = allRows.filter(
          (row) => sectionKeyForType(row.original.requestType) === section.key,
        )
        if (sectionRows.length === 0) return null
        const sectionIds = sectionRows.map((r) => r.original.id)
        return (
          <Card key={section.key}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  {section.title}
                  <Badge>{sectionRows.length}</Badge>
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    disabled={bulkReviewMutation.isPending}
                    onClick={() => bulkApprove(sectionIds)}
                  >
                    <Check className="h-3.5 w-3.5" /> وافق الكل
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-rose-300 text-rose-700 hover:bg-rose-50"
                    disabled={bulkReviewMutation.isPending}
                    onClick={() => bulkReject(sectionIds, section.title)}
                  >
                    <X className="h-3.5 w-3.5" /> ارفض الكل
                  </Button>
                </div>
              </div>
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
                  {sectionRows.map((row) => (
                    <TR key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TD key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}

      {(reviewMutation.isError || bulkReviewMutation.isError) ? (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {apiErrorMessage(reviewMutation.error ?? bulkReviewMutation.error, "تعذر تنفيذ الموافقة")}
        </div>
      ) : null}

      {/* Reject-all confirm dialog */}
      <Dialog open={Boolean(rejectConfirm)} onOpenChange={(open) => !open && setRejectConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تأكيد رفض الكل</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            هل تريد رفض جميع طلبات <strong>{rejectConfirm?.label}</strong>؟ ({rejectConfirm?.ids.length} طلب)
          </p>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setRejectConfirm(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={bulkReviewMutation.isPending}
              onClick={() => {
                if (rejectConfirm) bulkReviewMutation.mutate({ ids: rejectConfirm.ids, status: "REJECTED" })
                setRejectConfirm(null)
              }}
            >
              <X className="h-4 w-4" /> رفض الكل
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

  if (approval?.requestType === "NEGATIVE_STOCK_SALE") {
    const lines = data.lines ?? []
    return (
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2 dark:bg-slate-900">
          <Info label="الفاتورة" value={data.invoiceNumber || "-"} />
          <Info label="الزبون" value={data.customerName || "-"} />
        </div>
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          ⛔ هذه المواد بيعت وهي ناقصة من المخزن (رصيد سالب). سيُغطّى العجز تلقائياً عند وصول بضاعة جديدة. الموافقة تعني الاطلاع والإقرار فقط.
        </div>
        <div className="rounded-lg border">
          <div className="border-b bg-white px-4 py-3 font-semibold dark:bg-slate-900">المواد الناقصة</div>
          <div className="max-h-[45vh] overflow-auto">
            <Table>
              <THead>
                <TR><TH>المادة</TH><TH>المخزن</TH><TH>المباع</TH><TH>العجز</TH></TR>
              </THead>
              <TBody>
                {lines.map((line, i) => (
                  <TR key={i}>
                    <TD className="font-semibold">{line.productName}</TD>
                    <TD>{line.warehouseName || "-"}</TD>
                    <TD>{money(line.quantityPieces)} قطعة</TD>
                    <TD className="font-bold text-rose-700 dark:text-rose-400">{money(line.deficitPieces)} قطعة</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
        {approval?.requestType === "NEGATIVE_STOCK_SALE" && data.invoiceId ? (
          <Button variant="outline" className="w-full" onClick={() => window.open(`/invoices/${data.invoiceId}`, "_blank")}>
            <ExternalLink className="h-4 w-4" /> فتح الفاتورة
          </Button>
        ) : null}
        <Button className="w-full" disabled={approving} onClick={onApprove}>
          <Check className="h-4 w-4" /> موافقة (إقرار بالاطلاع)
        </Button>
      </div>
    )
  }

  if (approval?.requestType === "CREATE_TRANSFER") {
    const snap = data.snapshot
    return (
      <div className="space-y-4">
        <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
          <Info label="الموظف" value={data.requesterName || "-"} />
          <Info label="من مخزن" value={snap?.fromName || "-"} />
          <Info label="إلى مخزن" value={snap?.toName || "-"} />
        </div>
        {snap?.anyExceeds && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            ⚠️ الكمية المطلوبة أكبر من المتوفر في المصدر. الموافقة ستجعل مخزون المصدر سالباً وقد يظهر الفرق بالجرد.
          </div>
        )}
        <div className="rounded-lg border">
          <div className="border-b bg-white px-4 py-3 font-semibold">مواد التحويل</div>
          <div className="max-h-[45vh] overflow-auto">
            <Table>
              <THead>
                <TR><TH>المادة</TH><TH>الكمية</TH><TH>المتوفر بالمصدر</TH></TR>
              </THead>
              <TBody>
                {(snap?.items ?? []).map((item, i) => (
                  <TR key={i} className={item.exceedsStock ? "bg-amber-50" : ""}>
                    <TD className="font-semibold">{item.productName}</TD>
                    <TD>{money(item.quantity)} {unitLabel(item.unit)} ({money(item.requestedPieces)} قطعة)</TD>
                    <TD className={item.exceedsStock ? "font-bold text-amber-700" : ""}>
                      {money(item.availablePieces)} قطعة {item.exceedsStock ? "⚠️" : ""}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
        <Button className="w-full" disabled={approving} onClick={onApprove}>
          <Check className="h-4 w-4" /> وافق ونفّذ التحويل
        </Button>
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
