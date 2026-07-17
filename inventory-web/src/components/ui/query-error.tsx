// Shared "list failed to load" box with a retry button. Pages used to render
// an empty list on query failure — the user couldn't tell "no data" from
// "request failed" and kept refreshing the whole page.
export function QueryErrorBox({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/30">
      <p className="font-semibold text-rose-700 dark:text-rose-400">{title}</p>
      <p className="mt-1 text-sm text-rose-500">تحقق من الاتصال بالخادم ثم اضغط إعادة المحاولة.</p>
      <button
        onClick={onRetry}
        className="mt-3 rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
      >
        إعادة المحاولة
      </button>
    </div>
  )
}
