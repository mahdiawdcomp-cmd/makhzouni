import { AlertTriangle, LogOut, Save } from "lucide-react"
import { useState } from "react"
import { Button } from "./button"

type Blocker = ReturnType<typeof import("react-router-dom").useBlocker>

interface Props {
  blocker: Blocker
  onSave?: () => Promise<void>
  message?: string
}

export function UnsavedChangesDialog({
  blocker,
  onSave,
  message = "لديك تغييرات غير محفوظة. اختر حفظها قبل الخروج أو مغادرة الصفحة دون حفظ.",
}: Props) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  if (blocker.state !== "blocked") return null

  async function handleSaveAndLeave() {
    if (!onSave || saving) return
    setSaving(true)
    setSaveError("")
    try {
      await onSave()
      blocker.proceed?.()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "تعذر حفظ الفاتورة. راجع البيانات وحاول مرة ثانية.")
      blocker.reset?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2 className="mb-2 text-base font-bold text-slate-800 dark:text-slate-100">تغييرات غير محفوظة</h2>
        <p className="mb-5 text-sm leading-6 text-slate-500 dark:text-slate-400">{message}</p>
        {saveError ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{saveError}</p> : null}
        <div className="flex flex-col gap-2">
          {onSave ? (
            <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void handleSaveAndLeave()} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? "جاري الحفظ..." : "حفظ وخروج"}
            </Button>
          ) : null}
          <Button variant="outline" className="w-full border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/20" onClick={() => blocker.proceed?.()} disabled={saving}>
            <LogOut className="h-4 w-4" /> خروج دون حفظ
          </Button>
          <Button variant="outline" className="w-full" onClick={() => blocker.reset?.()} disabled={saving}>البقاء في الصفحة</Button>
        </div>
      </div>
    </div>
  )
}
