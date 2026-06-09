/**
 * UnsavedChangesDialog
 * ────────────────────
 * Custom 3-button blocker dialog shown when react-router blocks in-app
 * navigation because of unsaved changes.
 *
 * Buttons:
 *  حفظ وخروج       → calls onSave() then blocker.proceed()
 *  خروج بدون حفظ  → blocker.proceed()  (discard)
 *  البقاء في الصفحة → blocker.reset()   (cancel navigation)
 *
 * If onSave is undefined the "حفظ وخروج" button is hidden.
 */

import type { BlockerFunction } from "react-router-dom"
import { Button } from "./button"

type Blocker = ReturnType<typeof import("react-router-dom").useBlocker>

interface Props {
  blocker: Blocker
  /** Optional async save handler. If provided, a "حفظ وخروج" button appears. */
  onSave?: () => Promise<void>
  /** Label shown at the top of the dialog. */
  message?: string
}

export function UnsavedChangesDialog({
  blocker,
  onSave,
  message = "لديك تغييرات غير محفوظة. إذا غادرت الصفحة ستفقد هذه المعلومات.",
}: Props) {
  if (blocker.state !== "blocked") return null

  async function handleSaveAndLeave() {
    try {
      await onSave?.()
      blocker.proceed()
    } catch {
      // Save failed — stay on the page so the user can fix it
      blocker.reset()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        {/* Icon */}
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <span className="text-2xl">⚠️</span>
        </div>

        <h2 className="mb-2 text-base font-bold text-slate-800 dark:text-slate-100">
          تغييرات غير محفوظة
        </h2>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">{message}</p>

        <div className="flex flex-col gap-2">
          {/* Save & Exit — only shown when an onSave handler is provided */}
          {onSave && (
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleSaveAndLeave}
            >
              💾 حفظ وخروج
            </Button>
          )}

          {/* Discard & Exit */}
          <Button
            variant="outline"
            className="w-full border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/20"
            onClick={() => blocker.proceed()}
          >
            🚪 خروج بدون حفظ
          </Button>

          {/* Stay */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => blocker.reset()}
          >
            البقاء في الصفحة
          </Button>
        </div>
      </div>
    </div>
  )
}

// Re-export the type so callers don't have to import from react-router-dom directly
export type { BlockerFunction }
