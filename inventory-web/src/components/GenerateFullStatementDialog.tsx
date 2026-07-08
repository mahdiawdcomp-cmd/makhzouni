import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog"
import { Button } from "./ui/button"
import { toast } from "./ui/use-toast"
import { useSettings } from "../hooks/useSettings"
import { fetchAllCustomerStatements, buildStatementsHtmlReport } from "../utils/customerStatementExport"
import { downloadBlobUrl } from "../utils/download"
import { localDateStr } from "../utils/date"

type Phase = "idle" | "fetching" | "building" | "done" | "error"

export function GenerateFullStatementDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: settings } = useSettings()
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function run() {
      try {
        setPhase("fetching")
        const entries = await fetchAllCustomerStatements((done, total) => {
          if (!cancelled) setProgress({ done, total })
        })
        if (cancelled) return
        setPhase("building")
        const html = buildStatementsHtmlReport(
          entries,
          { storeName: settings?.storeName, storeLogo: settings?.storeLogo },
          new Date(),
        )
        const filename = `كشف-حساب-عام-${localDateStr()}.html`
        const blob = new Blob([html], { type: "text/html;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        downloadBlobUrl(url, filename)
        URL.revokeObjectURL(url)
        if (cancelled) return
        setPhase("done")
      } catch {
        if (!cancelled) {
          setPhase("error")
          toast({ title: "تعذر إنشاء الكشف العام", variant: "destructive" })
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
    // Intentionally only depends on `open` — this must fire exactly once per
    // dialog-open. Re-running on `phase` (set inside this same effect) would
    // tear down and cancel the in-flight fetch via the cleanup below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleOpenChange(next: boolean) {
    if (!next) {
      setPhase("idle")
      setProgress({ done: 0, total: 0 })
    }
    onOpenChange(next)
  }

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : phase === "building" ? 100 : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>حفظ الكشف العام</DialogTitle>
          <DialogDescription>
            {phase === "fetching" && "جاري جلب بيانات الزبائن..."}
            {phase === "building" && "جاري توليد الملف..."}
            {phase === "done" && "تم تحميل الملف بنجاح."}
            {phase === "error" && "حدث خطأ أثناء إنشاء الكشف."}
          </DialogDescription>
        </DialogHeader>

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
        </div>

        {(phase === "done" || phase === "error") && (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              إغلاق
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
