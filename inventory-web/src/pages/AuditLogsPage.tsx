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

function formatJson(value: unknown) {
  if (!value) return "-"
  return JSON.stringify(value, null, 2)
}

function metadataPart(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return undefined
  return (value as Record<string, unknown>)[key]
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
              {(logsQuery.data ?? []).map((log) => (
                <TR key={log.id}>
                  <TD>{String(log.createdAt).slice(0, 19).replace("T", " ")}</TD>
                  <TD>{log.user?.name ?? "-"}</TD>
                  <TD>{log.action}</TD>
                  <TD>{log.entity}</TD>
                  <TD className="max-w-40 truncate">{log.recordId ?? "-"}</TD>
                  <TD>
                    <details className="max-w-xl">
                      <summary className="cursor-pointer text-sm text-slate-600 dark:text-slate-300">عرض</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-100 p-3 text-xs dark:bg-slate-900">
                        {formatJson({
                          changes: metadataPart(log.metadata, "changes"),
                          requestBody: metadataPart(log.metadata, "requestBody"),
                          before: log.before,
                          after: log.after,
                        })}
                      </pre>
                    </details>
                  </TD>
                </TR>
              ))}
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
