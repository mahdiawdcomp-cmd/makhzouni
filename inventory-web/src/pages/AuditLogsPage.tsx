import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getAuditLogs } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

function formatJson(value: unknown) {
  if (!value) return "-"
  return JSON.stringify(value, null, 2)
}

export function AuditLogsPage() {
  const [draftEntity, setDraftEntity] = useState("")
  const [draftAction, setDraftAction] = useState("")
  const [draftFrom, setDraftFrom] = useState("")
  const [draftTo, setDraftTo] = useState("")
  const [filters, setFilters] = useState({
    entity: "",
    action: "",
    from: "",
    to: "",
  })

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">سجل التدقيق</h1>
        <p className="text-slate-500">كل عمليات الإضافة والتعديل والحذف الناجحة داخل النظام.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>الفلاتر</CardTitle></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_1fr_170px_170px_120px]">
          <Input value={draftEntity} onChange={(event) => setDraftEntity(event.target.value)} placeholder="الكيان: invoices, customers..." />
          <Input value={draftAction} onChange={(event) => setDraftAction(event.target.value)} placeholder="العملية: CREATE, UPDATE, DELETE" />
          <Input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} />
          <Input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} />
          <Button onClick={() => setFilters({ entity: draftEntity, action: draftAction, from: draftFrom, to: draftTo })}>بحث</Button>
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
                        {formatJson({ metadata: log.metadata, after: log.after })}
                      </pre>
                    </details>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
