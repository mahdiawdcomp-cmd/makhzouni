// «جرد بالسطور» entry point inside a warehouse page: start a count, share the
// worker link, and open the review of earlier counts.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardList, Copy, Plus } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { cancelLineCount, createLineCount, lineCountPublicUrl, listLineCounts, type LineCountStatus } from "../api/lineCount"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { toast } from "./ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"

const STATUS: Record<LineCountStatus, { label: string; cls: string }> = {
  OPEN: { label: "العامل يكتب", cls: "bg-sky-100 text-sky-700" },
  SUBMITTED: { label: "بانتظار مراجعتك", cls: "bg-amber-100 text-amber-800" },
  FINALIZED: { label: "معتمد", cls: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "ملغى", cls: "bg-slate-100 text-slate-500" },
}

export function LineCountPanel({ warehouseId, readOnly }: { warehouseId: string; readOnly: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [notes, setNotes] = useState("")
  const listQ = useQuery({ queryKey: ["line-counts", warehouseId], queryFn: () => listLineCounts(warehouseId) })

  const copy = (token: string) => {
    void navigator.clipboard
      .writeText(lineCountPublicUrl(token))
      .then(() => toast({ title: "انسخ رابط العامل" }))
      .catch(() => toast({ title: lineCountPublicUrl(token) }))
  }

  const createMut = useMutation({
    mutationFn: () => createLineCount({ warehouseId, notes: notes.trim() || undefined }),
    onSuccess: async (s) => {
      setNotes("")
      await qc.invalidateQueries({ queryKey: ["line-counts", warehouseId] })
      copy(s.publicToken)
    },
    onError: (err) => toast({ title: apiErrorMessage(err, "تعذر بدء الجرد"), variant: "destructive" }),
  })
  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelLineCount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["line-counts", warehouseId] }),
    onError: (err) => toast({ title: apiErrorMessage(err, "تعذر الإلغاء"), variant: "destructive" }),
  })

  const sessions = listQ.data ?? []
  const live = sessions.some((s) => s.status === "OPEN" || s.status === "SUBMITTED")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> جرد بالسطور</CardTitle>
        <p className="text-sm text-slate-500">العامل يكتب الجرد مثل الفاتورة بدون أسعار، ويشتغل حتى بدون نت. أنت تراجع الفروقات وتعتمدها.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!live && !readOnly && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظة للعامل (اختياري)"
              className="h-10 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              <Plus className="h-4 w-4" /> جرد جديد
            </Button>
          </div>
        )}
        {listQ.isError && <p className="text-sm text-red-600">{apiErrorMessage(listQ.error, "تعذر تحميل الجرود")}</p>}
        {sessions.length === 0 && !listQ.isLoading && <p className="text-sm text-slate-400">ما اكو جرد بالسطور لهذا المخزن بعد.</p>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                <span className="mx-2 text-sm text-slate-600 dark:text-slate-300">{new Date(s.createdAt).toLocaleString("ar-IQ")}</span>
                {s.lineCount > 0 && <span className="text-xs text-slate-400">{s.lineCount} سطر · {s.productCount} مادة</span>}
                {s.notes && <p className="text-xs text-slate-400">{s.notes}</p>}
              </div>
              <div className="flex gap-2">
                {s.status === "OPEN" && (
                  <Button variant="outline" size="sm" onClick={() => copy(s.publicToken)}><Copy className="h-4 w-4" /> رابط العامل</Button>
                )}
                {(s.status === "SUBMITTED" || s.status === "FINALIZED") && (
                  <Button size="sm" onClick={() => navigate(`/inventory/line-count/${s.id}`)}>
                    {s.status === "SUBMITTED" ? "راجع" : "عرض"}
                  </Button>
                )}
                {(s.status === "OPEN" || s.status === "SUBMITTED") && !readOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={cancelMut.isPending}
                    onClick={() => { if (confirm("إلغاء هذا الجرد؟ ما يتغيّر أي رصيد.")) cancelMut.mutate(s.id) }}
                  >
                    إلغاء
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
