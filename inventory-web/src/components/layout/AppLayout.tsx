import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import { Menu, X } from "lucide-react"
import { Header } from "./Header"
import { Sidebar } from "./Sidebar"

export function AppLayout() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("inventory_theme") === "dark",
  )
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode)
    localStorage.setItem("inventory_theme", darkMode ? "dark" : "light")
  }, [darkMode])

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [])

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ backgroundColor: "var(--theme-pageBg)", color: "var(--theme-textPrimary)" }}
    >
      {/* ── Desktop Sidebar ── */}
      <div className="hidden lg:flex lg:flex-col h-screen shrink-0 overflow-y-auto">
        <Sidebar />
      </div>

      {/* ── Mobile Sidebar Overlay ── */}
      {mobileSidebarOpen ? (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
          {/* Sidebar panel */}
          <div className="fixed inset-y-0 right-0 z-50 flex flex-col h-full lg:hidden shadow-2xl">
            <Sidebar />
          </div>
        </>
      ) : null}

      {/* ── Main area ── */}
      <div className="flex min-w-0 flex-1 flex-col h-screen overflow-hidden">
        {/* Mobile header top bar with hamburger */}
        <div
          className="flex h-14 items-center gap-3 border-b px-4 lg:hidden"
          style={{ backgroundColor: "var(--theme-headerBg)", borderColor: "var(--theme-cardBorder)" }}
        >
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-[15px] font-bold" style={{ color: "var(--theme-textPrimary)" }}>
            مخزوني
          </span>
        </div>

        {/* Desktop header */}
        <div className="hidden lg:block">
          <Header darkMode={darkMode} onToggleTheme={() => setDarkMode((v) => !v)} />
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
