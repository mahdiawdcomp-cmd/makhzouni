import { useEffect, useMemo, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { CheckCircle2, ChevronLeft, ChevronRight, Search, Trash2, Users } from "lucide-react"
import { createCustomer } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import rawRows from "../data/real-customers-import.json"

type RawRow = { code: number; name: string; phone: string; notes: string }
type Status = "pending" | "saved" | "skipped"
type RowState = { id: number; code: number; name: string; phone: string; address: string; notes: string; tags: string; status: Status }

const STORAGE_KEY = "customer_import_progress_v1"

function loadInitial(): RowState[] {
  const base: RowState[] = (rawRows as RawRow[]).map((r, i) => ({
    id: i,
    code: r.code,
    name: r.name,
    phone: r.phone,
    address: "",
    notes: r.notes,
    tags: "",
    status: "pending",
  }))
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<RowState>[] | null
    if (saved && Array.isArray(saved) && saved.length === base.length) {
      // Merge over base so older saved progress (before a field like `tags` existed) stays valid.
      return base.map((row, i) => ({ ...row, ...saved[i] }))
    }
  } catch {
    // ignore corrupt storage
  }
  return base
}

function extractErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string }
  return e?.response?.data?.message ?? e?.message ?? "تعذر الحفظ"
}

export function ImportCustomersPage() {
  usePageTitle("استيراد الزبائن")
  const [rows, setRows] = useState<RowState[]>(loadInitial)
  const [currentId, setCurrentId] = useState<number>(() => {
    const initial = loadInitial()
    return initial.find((r) => r.status === "pending")?.id ?? initial[0]?.id ?? 0
  })
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }, [rows])

  const counts = useMemo(() => {
    const saved = rows.filter((r) => r.status === "saved").length
    const skipped = rows.filter((r) => r.status === "skipped").length
    const pending = rows.length - saved - skipped
    return { saved, skipped, pending, total: rows.length }
  }, [rows])

  const pendingList = useMemo(() => rows.filter((r) => r.status === "pending"), [rows])

  const filteredList = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.trim().toLowerCase()
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.phone.includes(q) || String(r.code).includes(q))
  }, [rows, search])

  const current = rows.find((r) => r.id === currentId) ?? null
  const currentPendingIndex = pendingList.findIndex((r) => r.id === currentId)

  function goToNextPending(afterId: number) {
    const idx = pendingList.findIndex((r) => r.id === afterId)
    const next = pendingList.filter((r) => r.id !== afterId)[idx] ?? pendingList.find((r) => r.id !== afterId)
    if (next) setCurrentId(next.id)
  }

  function updateCurrent(patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.id === currentId ? { ...r, ...patch } : r)))
  }

  async function handleSave() {
    if (!current) return
    if (!current.name.trim()) {
      toast({ title: "الاسم مطلوب", variant: "destructive" })
      return
    }
    if (!current.phone.trim()) {
      toast({ title: "رقم الهاتف مطلوب للحفظ", description: "إذا الرقم غير معروف اضغط تجاهل بدل الحفظ", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      await createCustomer({
        name: current.name.trim(),
        phone: current.phone.trim(),
        address: current.address.trim() || undefined,
        notes: current.notes.trim() || undefined,
        tags: current.tags.split(",").map((t) => t.trim()).filter(Boolean),
        openingBalance: 0,
      })
      setRows((prev) => prev.map((r) => (r.id === current.id ? { ...r, status: "saved" } : r)))
      toast({ title: "✓ تم حفظ الزبون" })
      goToNextPending(current.id)
    } catch (err) {
      toast({ title: "تعذر الحفظ", description: extractErrorMessage(err), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  function handleSkip() {
    if (!current) return
    setRows((prev) => prev.map((r) => (r.id === current.id ? { ...r, status: "skipped" } : r)))
    goToNextPending(current.id)
  }

  function jumpTo(id: number) {
    setCurrentId(id)
  }

  function stepPending(direction: 1 | -1) {
    if (pendingList.length === 0) return
    const idx = pendingList.findIndex((r) => r.id === currentId)
    if (idx === -1) {
      setCurrentId(pendingList[0].id)
      return
    }
    const nextIdx = (idx + direction + pendingList.length) % pendingList.length
    setCurrentId(pendingList[nextIdx].id)
  }

  const progressPct = counts.total ? Math.round(((counts.saved + counts.skipped) / counts.total) * 100) : 0

  return (
    <div className="space-y-4 pb-10" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--theme-textPrimary)] flex items-center gap-2">
            <Users className="h-5 w-5" /> استيراد الزبائن من الملف القديم
          </h1>
          <p className="text-sm text-slate-500">راجع كل زبون، عدّل المعلومات الناقصة، ثم احفظه أو تجاهله.</p>
        </div>
        <div className="text-sm text-slate-500">
          <span className="text-emerald-600 font-semibold">{counts.saved} محفوظ</span>
          {" · "}
          <span className="text-slate-400 font-semibold">{counts.skipped} متجاهل</span>
          {" · "}
          <span className="text-amber-600 font-semibold">{counts.pending} متبقي</span>
          {" / "}
          {counts.total}
        </div>
      </div>

      <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="p-5 space-y-4">
            {!current ? (
              <div className="text-center py-16 text-slate-500">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
                خلصت كل القائمة 🎉
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">رمز قديم: {current.code}</span>
                  <span
                    className={
                      "text-xs px-2 py-0.5 rounded-full " +
                      (current.status === "saved"
                        ? "bg-emerald-100 text-emerald-700"
                        : current.status === "skipped"
                          ? "bg-slate-200 text-slate-600"
                          : "bg-amber-100 text-amber-700")
                    }
                  >
                    {current.status === "saved" ? "محفوظ" : current.status === "skipped" ? "متجاهل" : "قيد المراجعة"}
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">الاسم</label>
                    <Input value={current.name} onChange={(e) => updateCurrent({ name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">رقم الهاتف</label>
                    <Input
                      value={current.phone}
                      onChange={(e) => updateCurrent({ phone: e.target.value })}
                      placeholder="اكتب الرقم إذا كان ناقص"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">العنوان</label>
                    <Input value={current.address} onChange={(e) => updateCurrent({ address: e.target.value })} placeholder="اكتب العنوان" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">ملاحظات</label>
                    <Input value={current.notes} onChange={(e) => updateCurrent({ notes: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">تاكات (افصل بفاصلة، مثال: VIP, الكرادة)</label>
                    <Input value={current.tags} onChange={(e) => updateCurrent({ tags: e.target.value })} placeholder="مثال: VIP, الكرادة" />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button onClick={handleSave} disabled={saving}>
                    <CheckCircle2 className="h-4 w-4 ml-1" /> حفظ كزبون
                  </Button>
                  <Button variant="outline" onClick={handleSkip} disabled={saving}>
                    <Trash2 className="h-4 w-4 ml-1" /> تجاهل / حذف
                  </Button>
                  <div className="flex-1" />
                  <Button variant="ghost" size="icon" onClick={() => stepPending(-1)} title="السابق المتبقي">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-slate-400">
                    {pendingList.length ? `${Math.max(currentPendingIndex, 0) + 1} / ${pendingList.length} متبقي` : ""}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => stepPending(1)} title="التالي المتبقي">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pr-8" placeholder="بحث بالاسم أو الرقم..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {filteredList.map((r) => (
                <button
                  key={r.id}
                  onClick={() => jumpTo(r.id)}
                  className={
                    "w-full text-right px-2 py-2 text-sm flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 " +
                    (r.id === currentId ? "bg-[var(--theme-accent)]/10" : "")
                  }
                >
                  <span className="truncate">{r.name || "(بلا اسم)"}</span>
                  <span
                    className={
                      "shrink-0 text-[10px] px-1.5 py-0.5 rounded-full " +
                      (r.status === "saved"
                        ? "bg-emerald-100 text-emerald-700"
                        : r.status === "skipped"
                          ? "bg-slate-200 text-slate-500"
                          : "bg-amber-100 text-amber-700")
                    }
                  >
                    {r.status === "saved" ? "✓" : r.status === "skipped" ? "—" : "•"}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
