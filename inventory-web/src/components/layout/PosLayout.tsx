import { Outlet, useNavigate } from "react-router-dom"
import { LogOut, X } from "lucide-react"
import { useAuthStore } from "../../store/authStore"

export function PosLayout() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)

  function exit() {
    navigate("/")
  }

  function handleLogout() {
    logout()
    navigate("/login")
  }

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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleLogout}
            title="تسجيل خروج"
            className="flex h-6 items-center gap-1 rounded px-2 text-xs text-slate-400 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/30"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>خروج</span>
          </button>
          <button
            type="button"
            onClick={exit}
            title="إغلاق وضع الكاشير (Esc)"
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-900/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-3">
        <Outlet />
      </main>
    </div>
  )
}
