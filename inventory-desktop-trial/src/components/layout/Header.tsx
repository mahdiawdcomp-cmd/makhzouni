import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, LogOut, Moon, Sun, Sparkles } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router-dom"
import { logout } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
import { NotificationsBell } from "./NotificationsBell"
import { LanguageSwitcher } from "./LanguageSwitcher"

function useCurrentPageLabel(): string {
  const { pathname, search } = useLocation()

  if (pathname === "/") return "الرئيسية"
  if (pathname.startsWith("/inventory/transfers")) return "التحويلات"
  if (pathname.startsWith("/inventory/low-stock")) return "مخزون منخفض"
  if (pathname.startsWith("/inventory")) return "المخزن"
  if (pathname === "/invoices/new") return "فاتورة جديدة"
  if (pathname === "/invoices/returns") return "مرتجع مبيعات"
  if (pathname.startsWith("/quotations")) return "عروض الأسعار"
  if (pathname.startsWith("/invoices")) {
    if (search.includes("PURCHASE")) return "فواتير الشراء"
    if (search.includes("SALES_RETURN")) return "مرتجع مبيعات"
    if (search.includes("SALE")) return "فواتير البيع"
    return "الفواتير"
  }
  if (pathname.startsWith("/vouchers")) {
    if (search.includes("RECEIPT")) return "سندات القبض"
    if (search.includes("PAYMENT")) return "سندات الدفع"
    if (search.includes("EXPENSE")) return "المصاريف"
    return "السندات"
  }
  if (pathname.startsWith("/customers")) return "الزبائن"
  if (pathname.startsWith("/account")) return "كشف الحساب"
  if (pathname.startsWith("/reports")) return "التقارير"
  if (pathname.startsWith("/settings")) return "الإعدادات"
  if (pathname.startsWith("/users")) return "المستخدمين"
  if (pathname.startsWith("/approvals")) return "الموافقات"
  if (pathname.startsWith("/audit-logs")) return "سجل التدقيق"
  if (pathname.startsWith("/branches")) return "الفروع"
  if (pathname.startsWith("/coupons")) return "الكوبونات"
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
  const displayName = user?.name ?? "مستخدم"
  const avatarLetter = displayName.charAt(0)

  return (
    <header className="glass flex h-14 shrink-0 items-center justify-between px-5 sticky top-0 z-30">
      {/* Page title */}
      <div className="flex items-center gap-3">
        <div
          className="h-5 w-[3px] rounded-full"
          style={{ background: "linear-gradient(180deg, #6366F1, #8B5CF6)" }}
        />
        <h1 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--theme-textPrimary)" }}>
          {pageTitle}
        </h1>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <motion.button
          type="button"
          onClick={onToggleTheme}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex h-8 w-8 items-center justify-center rounded-lg transition"
          style={{ color: "var(--theme-textSecondary)" }}
          aria-label="تبديل الوضع"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={darkMode ? "sun" : "moon"}
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </motion.div>
          </AnimatePresence>
        </motion.button>

        <LanguageSwitcher />

        <NotificationsBell />

        {/* Divider */}
        <div className="mx-2 h-5 w-px" style={{ background: "var(--theme-cardBorder)" }} />

        {/* User menu */}
        <div className="relative">
          <motion.button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            onBlur={() => setTimeout(() => setUserMenuOpen(false), 150)}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition"
            style={{ color: "var(--theme-textPrimary)" }}
          >
            {/* Avatar */}
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
              style={{
                background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
                boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
              }}
            >
              {avatarLetter}
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-[13px] font-semibold leading-none" style={{ color: "var(--theme-textPrimary)" }}>
                {displayName}
              </div>
              <div className="mt-0.5 text-[10px] leading-none" style={{ color: "var(--theme-textSecondary)" }}>
                {roleLabel}
              </div>
            </div>
            <motion.div animate={{ rotate: userMenuOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--theme-textSecondary)" }} />
            </motion.div>
          </motion.button>

          <AnimatePresence>
            {userMenuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border py-1.5 shadow-xl"
                style={{
                  backgroundColor: "var(--theme-cardBg)",
                  borderColor: "var(--theme-cardBorder)",
                  boxShadow: "var(--z-shadow-lg)",
                }}
              >
                {/* User info */}
                <div
                  className="mx-2 mb-1.5 rounded-xl p-3"
                  style={{ background: "var(--theme-accentSoft)" }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                      style={{
                        background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
                        boxShadow: "0 4px 12px rgba(99,102,241,0.4)",
                      }}
                    >
                      {avatarLetter}
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold" style={{ color: "var(--theme-textPrimary)" }}>
                        {displayName}
                      </div>
                      <div
                        className="mt-0.5 flex items-center gap-1 text-[11px]"
                        style={{ color: "var(--theme-accent)" }}
                      >
                        <Sparkles className="h-2.5 w-2.5" />
                        {roleLabel}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Logout */}
                <button
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="flex w-[calc(100%-16px)] items-center gap-3 rounded-lg mx-2 px-3 py-2.5 text-[13px] text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950/20 active:scale-95"
                >
                  <LogOut className="h-4 w-4" />
                  {logoutMutation.isPending ? "جاري الخروج..." : "تسجيل الخروج"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  )
}
