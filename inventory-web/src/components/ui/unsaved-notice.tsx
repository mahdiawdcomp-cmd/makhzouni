/**
 * «عندك تغييرات ما انحفظت».
 *
 * Every settings card in this app follows the same shape: a local draft, and
 * a save button that only wakes up once the draft exists. The gap between
 * those two is invisible — the screen has already responded to the change, so
 * it reads as applied, and a refresh silently throws it away. That is exactly
 * how a merchant hid three catalog sections, refreshed, and found them back.
 *
 * One line, said the same way everywhere, so the gap is never invisible again.
 */
export function UnsavedNotice({ show, what = "تغييرات" }: { show: boolean; what?: string }) {
  if (!show) return null
  return (
    <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      ⚠️ عندك {what} ما انحفظت — اضغط زر الحفظ وإلا تروح لو حدّثت الصفحة.
    </p>
  )
}
