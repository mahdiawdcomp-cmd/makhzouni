import { useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { useSettings } from "../hooks/useSettings"
import { fetchAllCustomerStatements, buildStatementsHtmlReport, type StatementExportFilter } from "../utils/customerStatementExport"
import { saveGeneratedTextFile } from "../utils/download"
import { localDateStr } from "../utils/date"
import { cn } from "../utils/cn"

type Phase = "options" | "fetching" | "building" | "done" | "error"
type CustomerScope = "all" | "withBalance" | "inactive"
type DateScope = "all" | "month" | "custom"

const CUSTOMER_SCOPES: { id: CustomerScope; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "withBalance", label: "عليهم حساب" },
  { id: "inactive", label: "غائبون من فترة" },
]

const DATE_SCOPES: { id: DateScope; label: string }[] = [
  { id: "all", label: "كل المدة" },
  { id: "month", label: "هذا الشهر" },
  { id: "custom", label: "نطاق مخصص" },
]

export function GenerateFullStatementDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: settings } = useSettings()
  const [phase, setPhase] = useState<Phase>("options")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const [customerScope, setCustomerScope] = useState<CustomerScope>("all")
  const [inactiveDays, setInactiveDays] = useState(30)
  const [dateScope, setDateScope] = useState<DateScope>("all")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")

  function reset() {
    setPhase("options")
    setProgress({ done: 0, total: 0 })
    setSavedPath(null)
  }

  function handleOpenChange(next: boolean) {
    cancelledRef.current = !next
    if (!next) reset()
    onOpenChange(next)
  }

  function buildFilter(): StatementExportFilter {
    const filter: StatementExportFilter = { customerFilter: customerScope }
    if (customerScope === "inactive") filter.inactiveDays = inactiveDays
    if (dateScope === "all") {
      filter.all = true
    } else if (dateScope === "month") {
      const now = new Date()
      filter.from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
    } else {
      if (customFrom) filter.from = customFrom
      if (customTo) filter.to = customTo
    }
    return filter
  }

  async function handleGenerate() {
    cancelledRef.current = false
    try {
      setPhase("fetching")
      const entries = await fetchAllCustomerStatements(buildFilter(), (done, total) => {
        if (!cancelledRef.current) setProgress({ done, total })
      })
      if (cancelledRef.current) return
      setPhase("building")
      const html = buildStatementsHtmlReport(
        entries,
        { storeName: settings?.storeName, storeLogo: settings?.storeLogo },
        new Date(),
      )
      const filename = `كشف-حساب-عام-${localDateStr()}.html`
      const saved = await saveGeneratedTextFile(filename, html)
      if (cancelledRef.current) return
      setSavedPath(saved)
      setPhase("done")
    } catch {
      if (!cancelledRef.current) {
        setPhase("error")
        toast({ title: "تعذر إنشاء الكشف العام", variant: "destructive" })
      }
    }
  }

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : phase === "building" ? 100 : 0

  function ScopeButtons<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-md border px-2 py-1.5 text-xs font-medium transition",
              value === opt.id
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300"
                : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>حفظ الكشف العام</DialogTitle>
          <DialogDescription>
            {phase === "options" && "اختر نطاق الزبائن والفترة الزمنية قبل التوليد."}
            {phase === "fetching" && "جاري جلب بيانات الزبائن..."}
            {phase === "building" && "جاري توليد الملف..."}
            {phase === "done" && "تم حفظ الملف بنجاح."}
            {phase === "error" && "حدث خطأ أثناء إنشاء الكشف."}
          </DialogDescription>
        </DialogHeader>

        {phase === "options" && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500">الزبائن</label>
              <div className="mt-1.5">
                <ScopeButtons value={customerScope} options={CUSTOMER_SCOPES} onChange={setCustomerScope} />
              </div>
              {customerScope === "inactive" && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-slate-500">غائبون منذ أكثر من</span>
                  <Input
                    className="h-8 w-20"
                    type="number"
                    min={1}
                    value={inactiveDays}
                    onChange={(e) => setInactiveDays(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <span className="text-xs text-slate-500">يوم</span>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500">الفترة</label>
              <div className="mt-1.5">
                <ScopeButtons value={dateScope} options={DATE_SCOPES} onChange={setDateScope} />
              </div>
              {dateScope === "custom" && (
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-400">من</label>
                    <Input className="h-8" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">إلى</label>
                    <Input className="h-8" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            <Button className="w-full" onClick={() => void handleGenerate()}>
              توليد الكشف
            </Button>
          </div>
        )}

        {phase !== "options" && (
          <div className="space-y-3">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            {phase === "fetching" && progress.total > 0 && (
              <p className="text-sm text-slate-500">
                {progress.done} من {progress.total} زبون
              </p>
            )}
            {phase === "done" && savedPath && (
              <p className="break-all text-sm text-slate-500">تم الحفظ في: {savedPath}</p>
            )}
          </div>
        )}

        {(phase === "done" || phase === "error") && (
          <div className="mt-4 flex justify-end gap-2">
            {phase === "error" && (
              <Button variant="outline" onClick={reset}>
                رجوع
              </Button>
            )}
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              إغلاق
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
