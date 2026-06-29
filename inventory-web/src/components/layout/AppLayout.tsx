import { useEffect, useRef, useState, type MouseEvent } from "react"
import { Outlet, useLocation, Link, Navigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { AlertTriangle, Menu, Moon, Sun, X, Zap } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getLicenseStatus, getMe } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
import { Header } from "./Header"
import { Sidebar, SidebarTopBar } from "./Sidebar"
import { useUiStore } from "../../store/uiStore"
import { PwaStatusBar } from "../PwaStatusBar"
import { usePwaStatus } from "../../pwa/usePwaStatus"
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts"
import { useGlobalBarcodeScanner } from "../../hooks/useGlobalBarcodeScanner"
import { OnboardingWizard } from "../OnboardingWizard"
import { AgentButton } from "../agent/AgentButton"
import { ErrorBoundary } from "../ErrorBoundary"
import { toast } from "../ui/use-toast"
import { LanguageSwitcher } from "./LanguageSwitcher"

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  enter:   { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -6 },
}

const pageTransition = {
  duration: 0.24,
  ease: "easeOut" as const,
}

function LicenseBanner() {
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN")
  const [dismissed, setDismissed] = useState(false)
  const { data: license } = useQuery({
    queryKey: ["license-status"],
    queryFn: getLicenseStatus,
    staleTime: 60 * 60 * 1000, // re-check every hour
    enabled: isAdmin,
  })

  if (!isAdmin || dismissed || !license) return null
  if (license.status === "valid" || license.status === "missing") return null

  const isExpired = license.status === "expired"
  const label = isExpired
    ? `انتهت صلاحية الترخيص${license.readOnlyMode ? " — وضع القراءة فقط" : " — فترة السماح"}`
    : license.daysLeft != null ? `ينتهي الترخيص خلال ${license.daysLeft} يوم` : "الترخيص قارب على الانتهاء"

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium"
      style={{
        background: isExpired ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
        borderBottom: `1px solid ${isExpired ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
        color: isExpired ? "#ef4444" : "#f59e0b",
      }}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{label}</span>
        <Link to="/settings" className="underline underline-offset-2 opacity-80 hover:opacity-100">
          الإعدادات
        </Link>
      </div>
      <button type="button" onClick={() => setDismissed(true)} className="opacity-60 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function AppLayout() {
  const isPosOnly = useAuthStore((s) => s.isPosOnly())
  const refreshUser = useAuthStore((s) => s.refreshUser)
  const token = useAuthStore((s) => s.token)
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("inventory_theme") === "dark",
  )
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const focusMode = useUiStore((s) => s.focusMode)
  const pwa = usePwaStatus()
  const qc = useQueryClient()
  useGlobalShortcuts()
  useGlobalBarcodeScanner()

  useEffect(() => {
    if (pwa.lastSyncAt) {
      void qc.invalidateQueries()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pwa.lastSyncAt])

  // Never let a queued offline operation fail silently.
  useEffect(() => {
    if (pwa.syncFailures && pwa.syncFailures.items.length > 0) {
      const first = pwa.syncFailures.items[0]
      const extra = pwa.syncFailures.items.length - 1
      toast({
        title: "تعذّر حفظ بعض العمليات بعد رجوع الإنترنت",
        description: `${first.message ?? "عملية مرفوضة من الخادم"}${extra > 0 ? ` (و${extra} غيرها)` : ""} — يرجى إعادة إدخالها.`,
        variant: "destructive",
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pwa.syncFailures?.at])

  useEffect(() => {
    if (pwa.authBlockedAt) {
      toast({
        title: "انتهت الجلسة",
        description: "سجّل الدخول من جديد حتى تُزامن العمليات المحفوظة محلياً.",
        variant: "destructive",
      })
    }
  }, [pwa.authBlockedAt])
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const invoiceDraftOpen = pathname === "/invoices/new"

  function keepInvoiceOpen(event: MouseEvent<HTMLDivElement>) {
    if (!invoiceDraftOpen || event.defaultPrevented || event.button !== 0) return
    const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
    const destination = new URL(anchor.href, window.location.origin)
    if (destination.origin !== window.location.origin) return
    if (destination.pathname === pathname && destination.search === window.location.search) return
    event.preventDefault()
    event.stopPropagation()
    window.open(`${destination.pathname}${destination.search}${destination.hash}`, "_blank", "noopener,noreferrer")
  }

  // Refresh user permissions from DB on every app open
  useEffect(() => {
    if (!token) return
    getMe().then((user) => { if (user) refreshUser(user) }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Per-route scroll memory: remember where the user was on each route so that
  // returning to it (e.g. back from a product/invoice detail) restores the same
  // scroll position instead of always jumping to the top.
  const scrollPositions = useRef<Record<string, number>>({})
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onScroll = () => { scrollPositions.current[pathname] = el.scrollTop }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [pathname])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const saved = scrollPositions.current[pathname] ?? 0
    // Wait a frame so the destination route has rendered (container has its full
    // height) before restoring — otherwise scrollTo would clamp to a short page.
    const raf = requestAnimationFrame(() => el.scrollTo(0, saved))
    return () => cancelAnimationFrame(raf)
  }, [pathname])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("inventory_theme", darkMode ? "dark" : "light")
  }, [darkMode])

  // All hooks above run unconditionally; only now may we bail out of rendering.
  if (isPosOnly && pathname !== "/pos") return <Navigate to="/pos" replace />

  return (
    <div
      onClickCapture={keepInvoiceOpen}
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--theme-pageBg)", color: "var(--theme-textPrimary)" }}
    >
      {/* Desktop Sidebar — collapses to top icon strip in focus mode */}
      {!focusMode && (
        <div className="hidden lg:flex lg:flex-col h-screen shrink-0 overflow-y-auto">
          <Sidebar />
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/60 lg:hidden backdrop-blur-sm"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.div
              key="sidebar"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 right-0 z-50 flex flex-col h-full lg:hidden shadow-2xl"
            >
              <Sidebar />
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="absolute top-4 left-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col h-screen overflow-hidden">
        {/* Focus-mode top nav strip (replaces sidebar when writing an invoice) */}
        {focusMode && <SidebarTopBar />}
        <PwaStatusBar
          isOnline={pwa.isOnline}
          pendingCount={pwa.pendingCount}
          needsRefresh={pwa.needsRefresh}
          onRefresh={pwa.refreshApp}
          onSync={pwa.syncNow}
        />

        {/* Mobile top bar */}
        <div
          className="glass flex h-14 items-center gap-3 px-4 lg:hidden"
        >
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition"
            style={{ color: "var(--theme-textSecondary)" }}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)" }}
            >
              <Zap className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-[14px] font-bold tracking-tight" style={{ color: "var(--theme-textPrimary)" }}>
              مخزوني
            </span>
          </div>
          <div className="ms-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDarkMode((value) => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ color: "var(--theme-textSecondary)" }}
              aria-label="تبديل الوضع"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <LanguageSwitcher />
          </div>
        </div>

        {/* License banner (admin only, when expiring/expired) */}
        <LicenseBanner />

        {/* Desktop header */}
        <div className="hidden lg:block">
          <Header darkMode={darkMode} onToggleTheme={() => setDarkMode((v) => !v)} />
        </div>

        {/* Page content with transition */}
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              variants={pageVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              transition={pageTransition}
              className="p-4 lg:p-6 min-h-full"
            >
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <OnboardingWizard />
      <AgentButton />
    </div>
  )
}
