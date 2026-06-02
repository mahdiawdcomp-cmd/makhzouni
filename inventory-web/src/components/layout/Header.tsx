import { useState } from "react"
import { LogOut, Moon, Sun, ChevronDown } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { useNavigate, useLocation } from "react-router-dom"
import { logout } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
import { NotificationsBell } from "./NotificationsBell"

function useCurrentPageLabel(): string {
  const { pathname, search } = useLocation()
  if (pathname === "/")                         return "الرئيسية"
  if (pathname.startsWith("/inventory/transfers")) return "التحويلات"
  if (pathname.startsWith("/inventory/low-stock")) return "مخزون منخفض"
  if (pathname.startsWith("/inventory"))        return "المخزن"
  if (pathname === "/invoices/new")             return "فاتورة جديدة"
  if (pathname.startsWith("/invoices"))        {
    if (search.includes("PURCHASE"))            return "فواتير الشراء"
    if (search.includes("SALE"))               return "فواتير البيع"
    return "الفواتير"
  }
  if (pathname.startsWith("/vouchers"))        {
    if (search.includes("RECEIPT"))            return "سندات القبض"
    if (search.includes("PAYMENT"))            return "سندات الدفع"
    if (search.includes("EXPENSE"))            return "المصاريف"
    return "السندات"
  }
  if (pathname.startsWith("/customers"))       return "الزبائن"
  if (pathname.startsWith("/account"))         return "كشف الحساب"
  if (pathname.startsWith("/reports"))         return "التقارير"
  if (pathname.startsWith("/settings"))        return "الإعدادات"
  if (pathname.startsWith("/users"))           return "المستخدمين"
  if (pathname.startsWith("/approvals"))       return "الموافقات"
  if (pathname.startsWith("/audit-logs"))      return "سجل التدقيق"
  if (pathname.startsWith("/branches"))        return "الفروع"
  return "مخزوني"
}

interface HeaderProps {
  darkMode: boolean
  onToggleTheme: () => void
}

export function Header({ darkMode, onToggleTheme }: HeaderProps) {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const clearSession = useAuthStore((state) => state.logout)
  const pageTitle = useCurrentPageLabel()
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      clearSession()
      navigate("/login", { replace: true })
    },
  })

  const roleLabel = user?.role === "ADMIN" ? "مدير النظام" : "موظف"

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b px-5"
      style={{
        backgroundColor: "var(--theme-headerBg)",
        borderColor: "var(--theme-cardBorder)",
        color: "var(--theme-textPrimary)",
      }}
    >
      {/* ── Left: Page title ── */}
      <div className="flex items-center gap-2">
        <h1 className="text-[15px] font-semibold text-[var(--theme-textPrimary)]">
          {pageTitle}
        </h1>
      </div>

      {/* ── Right: Actions ── */}
      <div className="flex items-center gap-1">
        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="تبديل الوضع"
        >
          {darkMode
            ? <Sun className="h-4 w-4" />
            : <Moon className="h-4 w-4" />}
        </button>

        {/* Notifications */}
        <NotificationsBell />

        {/* Divider */}
        <div className="mx-2 h-6 w-px bg-slate-200 dark:bg-slate-700" />

        {/* User menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            onBlur={() => setTimeout(() => setUserMenuOpen(false), 150)}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {/* Avatar */}
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white shrink-0"
              style={{ backgroundColor: "var(--theme-accent)" }}
            >
              {(user?.name ?? "م").charAt(0)}
            </div>
            <div className="hidden sm:block text-right">
              <div className="text-[13px] font-semibold leading-none text-[var(--theme-textPrimary)]">
                {user?.name ?? "مستخدم"}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 leading-none">
                {roleLabel}
              </div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          </button>

          {/* Dropdown */}
          {userMenuOpen ? (
            <div
              className="absolute left-0 top-full mt-1.5 w-52 rounded-lg border bg-white py-1.5 shadow-lg dark:bg-slate-900 z-50"
              style={{ borderColor: "var(--theme-cardBorder)" }}
            >
              <div className="border-b px-4 py-3 dark:border-slate-700" style={{ borderColor: "var(--theme-cardBorder)" }}>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white shrink-0"
                    style={{ backgroundColor: "var(--theme-accent)" }}
                  >
                    {(user?.name ?? "م").charAt(0)}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--theme-textPrimary)]">
                      {user?.name}
                    </div>
                    <div className="text-[11px] text-slate-500">{roleLabel}</div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <LogOut className="h-4 w-4" />
                تسجيل الخروج
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
