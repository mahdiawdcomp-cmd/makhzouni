import { AlertTriangle } from "lucide-react"
import { explainError, errorRefLabel } from "../../utils/apiError"

/**
 * Staff-facing error box: shows the message, the technical reference
 * («خطأ 409 · CODE»), the السبب, and the الحل — so any employee who hits an
 * error understands what happened and what to do, and can quote the code to
 * support. Use anywhere a mutation/request can fail.
 */
export function ErrorExplain({
  error,
  fallback,
  className = "",
}: {
  error: unknown
  fallback?: string
  className?: string
}) {
  if (!error) return null
  const e = explainError(error, fallback)
  const ref = errorRefLabel(e)

  return (
    <div
      dir="rtl"
      className={`rounded-lg border border-red-200 bg-red-50 p-3 text-right text-sm ${className}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-red-800">{e.message}</p>
          {ref ? (
            <p className="text-[11px] font-mono text-red-500">{ref}</p>
          ) : null}
          <p className="text-[13px] text-red-700">
            <span className="font-semibold">السبب: </span>
            {e.cause}
          </p>
          <p className="text-[13px] text-emerald-800">
            <span className="font-semibold">الحل: </span>
            {e.solution}
          </p>
        </div>
      </div>
    </div>
  )
}
