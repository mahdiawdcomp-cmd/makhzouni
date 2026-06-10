import { useEffect, useRef, useState } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Menu, X, Zap } from "lucide-react"
import { Header } from "./Header"
import { Sidebar } from "./Sidebar"
import { PwaStatusBar } from "../PwaStatusBar"
import { usePwaStatus } from "../../pwa/usePwaStatus"
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts"
import { OnboardingWizard } from "../OnboardingWizard"
import { AgentButton } from "../agent/AgentButton"
import { ErrorBoundary } from "../ErrorBoundary"

const pageVariants = {
  initial: { opacity: 0, y: 10 },
  enter:   { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -6 },
}

const pageTransition = {
  duration: 0.24,
  ease: "easeOut" as const,
}

export function AppLayout() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("inventory_theme") === "dark",
  )
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const pwa = usePwaStatus()
  useGlobalShortcuts()
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("inventory_theme", darkMode ? "dark" : "light")
  }, [darkMode])

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--theme-pageBg)", color: "var(--theme-textPrimary)" }}
    >
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:flex-col h-screen shrink-0 overflow-y-auto">
        <Sidebar />
      </div>

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
        </div>

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
