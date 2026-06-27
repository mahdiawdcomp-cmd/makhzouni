import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getAuditLogs } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

const entityOptions = [
  { value: "", label: "كل الكيانات" },
  { value: "invoices", label: "الفواتير" },
  { value: "vouchers", label: "السندات" },
  { value: "products", label: "المواد" },
  { value: "customers", label: "الزبائن" },
  { value: "users", label: "المستخدمين" },
  { value: "branches", label: "المخازن / الفروع" },
  { value: "transfers", label: "التحويلات" },
  { value: "approvals", label: "الموافقات" },
  { value: "settings", label: "الإعدادات" },
  { value: "coupons", label: "الكوبونات" },
  { value: "quotations", label: "عروض الأسعار" },
]

const actionOptions = [
  { value: "", label: "كل العمليات" },
  { value: "CREATE", label: "إضافة" },
  { value: "UPDATE", label: "تعديل" },
  { value: "DELETE", label: "حذف / إلغاء" },
  { value: "REACTIVATE", label: "إرجاع نشط" },
]

const entityLabels: Record<string, string> = Object.fromEntries(
  entityOptions.filter((o) => o.value).map((o) => [o.value, o.label]),
)
const actionLabels: Record<string, string> = Object.fromEntries(
  actionOptions.filter((o) => o.value).map((o) => [o.value, o.label]),
)

// Human-readable Arabic labels for the most common changed fields. Anything not
// listed falls back to the raw key (still readable: name, price, …).
const fieldLabels: Record<string, string> = {
  name: "الاسم", phone: "الهاتف", address: "العنوان", notes: "ملاحظات",
  category: "الفئة", status: "الحالة", quantity: "الكمية", unit: "الوحدة",
  price: "السعر", unitPrice: "سعر الوحدة", salePrice: "سعر البيع",
  retailPrice: "سعر المفرد", purchasePrice: "سعر الشراء", costPrice: "الكلفة",
  oldPrice: "السعر القديم", discount: "الخصم", paidAmount: "المدفوع",
  totalAmount: "الإجمالي", subtotal: "المجموع", currentBalance: "الرصيد الحالي",
  openingBalance: "الرصيد الافتتاحي", creditLimit: "سقف الدين",
  minStock: "الحد الأدنى", openingBalancePcs: "الرصيد الافتتاحي (قطع)",
  cartonsAvailable: "الكراتين المتوفرة", pcsPerCarton: "قطع/كرتون",
  itemNumber: "رقم المادة", storageLocation: "موقع التخزين",
  isNewArrival: "وصل حديثاً", isOffer: "عرض", isActive: "مفعّل",
  isSupplier: "مورّد", deletedAt: "محذوف", date: "التاريخ", type: "النوع",
  paymentType: "نوع الدفع", expiryDate: "تاريخ الانتهاء",
}

// Keys that are internal / noisy and should never be shown to the end user.
const hiddenFields = new Set([
  "id", "createdAt", "updatedAt", "createdBy", "updatedBy", "deletedBy",
  "branchId", "customerId", "userId", "tenantId", "qrCode", "cartonQrCode",
  "imageUrl", "thumbnailUrl", "warehouseStocks", "currentStock",
])

function fieldLabel(key: string) {
  return fieldLabels[key] ?? key
}

function formatVal(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "نعم" : "لا"
  if (typeof value === "number") return value.toLocaleString("en-US")
  if (typeof value === "string") {
    // Hide long blobs (base64 images, tokens) and ISO timestamps tails.
    if (value.length > 60) return "…"
    return value.replace("T", " ").slice(0, 19) || "—"
  }
  if (Array.isArray(value)) return value.length ? `${value.length} عنصر` : "—"
  return "(تفاصيل)"
}

type ChangeMap = Record<string, { before: unknown; after: unknown }>

function readableChanges(metadata: unknown): Array<{ key: string; before: unknown; after: unknown }> {
  if (!metadata || typeof metadata !== "object" || !("changes" in metadata)) return []
  const changes = (metadata as { changes?: ChangeMap }).changes
  if (!changes || typeof changes !== "object") return []
  return Object.entries(changes)
    .filter(([key]) => !hiddenFields.has(key))
    .map(([key, v]) => ({ key, before: v?.before, after: v?.after }))
}

export function AuditLogsPage() {
  const [draftEntity, setDraftEntity] = useState("")
  const [draftAction, setDraftAction] = useState("")
  const [draftFrom, setDraftFrom] = useState("")
  const [draftTo, setDraftTo] = useState("")
  const [filters, setFilters] = useState({ entity: "", action: "", from: "", to: "" })

  const logsQuery = useQuery({
    queryKey: ["audit-logs", filters],
    queryFn: () =>
      getAuditLogs({
        entity: filters.entity || undefined,
        action: filters.action || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        limit: 100,
      }),
  })

  function applyFilters() {
    setFilters({ entity: draftEntity, action: draftAction, from: draftFrom, to: draftTo })
  }

  function clearFilters() {
    setDraftEntity("")
    setDraftAction("")
    setDraftFrom("")
    setDraftTo("")
    setFilters({ entity: "", action: "", from: "", to: "" })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">سجل التدقيق</h1>
        <p className="text-slate-500">كل عمليات الإضافة والتعديل والحذف الناجحة داخل النظام.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>الفلاتر</CardTitle></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[220px_180px_170px_170px_120px_120px]">
          <select
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            value={draftEntity}
            onChange={(event) => setDraftEntity(event.target.value)}
            aria-label="فلترة حسب الكيان"
          >
            {entityOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
          </select>
          <select
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            value={draftAction}
            onChange={(event) => setDraftAction(event.target.value)}
            aria-label="فلترة حسب العملية"
          >
            {actionOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
          </select>
          <Input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} aria-label="من تاريخ" />
          <Input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} aria-label="إلى تاريخ" />
          <Button onClick={applyFilters}>بحث</Button>
          <Button variant="outline" onClick={clearFilters}>تصفير</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>العمليات</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>الوقت</TH>
                <TH>المستخدم</TH>
                <TH>العملية</TH>
                <TH>الكيان</TH>
                <TH>السجل</TH>
                <TH>التفاصيل</TH>
              </TR>
            </THead>
            <TBody>
              {(logsQuery.data ?? []).map((log) => {
                const changes = readableChanges(log.metadata)
                return (
                <TR key={log.id}>
                  <TD>{String(log.createdAt).slice(0, 19).replace("T", " ")}</TD>
                  <TD>{log.user?.name ?? "-"}</TD>
                  <TD>{actionLabels[log.action] ?? log.action}</TD>
                  <TD>{entityLabels[log.entity] ?? log.entity}</TD>
                  <TD className="max-w-40 truncate">{log.recordId ?? "-"}</TD>
                  <TD>
                    {log.action === "UPDATE" && changes.length > 0 ? (
                      <ul className="space-y-1 text-xs">
                        {changes.map((c) => (
                          <li key={c.key} className="flex flex-wrap items-center gap-1">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">{fieldLabel(c.key)}:</span>
                            <span className="text-rose-600 line-through dark:text-rose-400">{formatVal(c.before)}</span>
                            <span className="text-slate-400">←</span>
                            <span className="text-emerald-700 dark:text-emerald-400">{formatVal(c.after)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </TD>
                </TR>
              )})}
            </TBody>
          </Table>
          {!logsQuery.isLoading && (logsQuery.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">لا توجد عمليات مطابقة للفلاتر.</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
