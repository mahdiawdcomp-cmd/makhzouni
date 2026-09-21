/**
 * «إعدادات المندوب» — what each rep may change on their own invoices.
 *
 * Receipts are shown here too, as a fixed line, so the owner sees the whole
 * rule in one place: a receipt is cash in the rep's hand, and no switch lets a
 * rep change one without the owner.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../api/client"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table"
import { QueryErrorBox } from "../../components/ui/query-error"
import { toast } from "../../components/ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"

type Mode = "OFF" | "APPROVAL" | "DIRECT"
type RepModes = { agentId: string; name: string; isActive: boolean; INVOICE_EDIT: Mode; INVOICE_CANCEL: Mode }

const OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: "DIRECT", label: "مباشر ويجيك إشعار" },
  { value: "APPROVAL", label: "بموافقتك" },
  { value: "OFF", label: "ممنوع" },
]

export function AgentSettingsPanel() {
  const qc = useQueryClient()
  const modes = useQuery({
    queryKey: ["sales-agent-admin", "edit-modes"],
    queryFn: async () => {
      const rows = (await api.get<{ data: RepModes[] | null }>("/sales-agent-admin/edit-modes")).data?.data
      // An unexpected shape empties this panel instead of throwing in `.map`.
      return Array.isArray(rows) ? rows : []
    },
    retry: 3,
  })

  const save = useMutation({
    mutationFn: async (input: { agentId: string; action: "INVOICE_EDIT" | "INVOICE_CANCEL"; value: Mode }) =>
      (await api.put(`/sales-agent-admin/edit-modes/${input.agentId}`, { [input.action]: input.value })).data,
    onSuccess: () => {
      toast({ title: "انحفظ ✓", description: "يسري من الضغطة الجاية للمندوب" })
      void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "edit-modes"] })
    },
    onError: (err) => toast({ title: "ما انحفظ", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const select = (row: RepModes, action: "INVOICE_EDIT" | "INVOICE_CANCEL") => (
    <select
      value={row[action]}
      disabled={save.isPending}
      onChange={(e) => save.mutate({ agentId: row.agentId, action, value: e.target.value as Mode })}
      aria-label={`${action === "INVOICE_EDIT" ? "تعديل الفاتورة" : "إلغاء الفاتورة"} — ${row.name}`}
      className="h-11 w-full min-w-[10rem] cursor-pointer rounded-xl border border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)] px-3 text-[13.5px]"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>صلاحيات تعديل المندوب</CardTitle>
          <p className="mt-0.5 text-[12px] text-slate-500">
            تنطبق على الفواتير المكتوبة من حساب المندوب بس. خصم أكثر من ٦٪ أو تحت الكلفة يحتاج موافقتك دائماً.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {modes.error ? (
          <QueryErrorBox title="ما وصلت الإعدادات" onRetry={() => void modes.refetch()} />
        ) : modes.isPending ? (
          <p className="py-6 text-center text-sm text-slate-500">جاري التحميل…</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>المندوب</TH>
                <TH>تعديل فاتورة</TH>
                <TH>إلغاء فاتورة</TH>
                <TH>سند القبض</TH>
              </TR>
            </THead>
            <TBody>
              {(modes.data ?? []).map((row) => (
                <TR key={row.agentId} className={row.isActive ? "" : "opacity-60"}>
                  <TD className="font-medium">{row.name}</TD>
                  <TD>{select(row, "INVOICE_EDIT")}</TD>
                  <TD>{select(row, "INVOICE_CANCEL")}</TD>
                  <TD className="text-[12px] text-slate-500">دائماً بموافقتك</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
