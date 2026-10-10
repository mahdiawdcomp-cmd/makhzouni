import { useEffect, useState } from "react"
import { Bell, BellRing, Loader2, PackageOpen } from "lucide-react"
import { enablePrepPush, pushPermission } from "../../utils/prepPush"

// «شاشة التجهيز» entry for the worker page — the worker had no way to reach
// /prep or to switch notifications on. Bilingual (ar / ur) like the page.
export function PrepWorkerCard({ lang }: { lang: "ar" | "ur" }) {
  const [state, setState] = useState<"on" | "off" | "busy">(() => (pushPermission() === "granted" ? "on" : "off"))
  const [error, setError] = useState("")
  const L = (ar: string, ur: string) => (lang === "ur" ? ur : ar)

  // Browser permission alone doesn't mean the server has this phone — re-register
  // quietly on every visit and show the real result.
  useEffect(() => {
    if (pushPermission() !== "granted") return
    void enablePrepPush().then((err) => { if (err) { setState("off"); setError(err) } })
  }, [])

  async function enable() {
    setState("busy")
    const err = await enablePrepPush()
    setError(err ?? "")
    setState(err ? "off" : "on")
  }

  return (
    <div className="space-y-3 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-3 shadow-sm dark:bg-emerald-950/30">
      <a
        href="/prep"
        className="flex items-center justify-center gap-3 rounded-2xl bg-emerald-600 py-5 text-2xl font-black text-white shadow-md active:scale-95"
      >
        <PackageOpen className="h-8 w-8" />
        {L("شاشة التجهيز", "تیاری اسکرین")}
      </a>

      {state === "on" ? (
        <div className="flex items-center justify-center gap-2 text-base font-bold text-emerald-700 dark:text-emerald-300">
          <Bell className="h-5 w-5" /> {L("الإشعارات شغّالة ✔", "نوٹیفکیشن آن ہیں ✔")}
        </div>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={state === "busy"}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 py-4 text-xl font-black text-slate-900 active:scale-95 disabled:opacity-60"
        >
          {state === "busy" ? <Loader2 className="h-6 w-6 animate-spin" /> : <BellRing className="h-6 w-6" />}
          {L("شغّل الإشعارات", "نوٹیفکیشن آن کریں")}
        </button>
      )}
      {error && <div className="rounded-xl bg-red-600 px-3 py-2 text-center text-sm font-semibold text-white" dir="ltr">{error}</div>}
    </div>
  )
}
