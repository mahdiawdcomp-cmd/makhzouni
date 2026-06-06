import { useEffect } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { X } from "lucide-react"

export function PosLayout() {
  const navigate = useNavigate()

  function exit() {
    navigate("/")
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") exit()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--theme-pageBg)", color: "var(--theme-textPrimary)" }}
    >
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b px-3"
        style={{ backgroundColor: "var(--theme-headerBg)", borderColor: "var(--theme-cardBorder)" }}
      >
        <span className="text-xs font-semibold tracking-wide opacity-60">وضع الكاشير</span>
        <button
          type="button"
          onClick={exit}
          title="خروج من وضع الكاشير (Esc)"
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <main className="flex-1 overflow-y-auto p-3">
        <Outlet />
      </main>
    </div>
  )
}
