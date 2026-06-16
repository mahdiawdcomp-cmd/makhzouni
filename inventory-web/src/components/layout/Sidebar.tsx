import { useState, type ComponentType } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowRightLeft,
  BarChart3,
  Boxes,
  ChevronDown,
  FileCheck2,
  FileText,
  Globe,
  Home,
  KeyRound,
  Plus,
  Receipt,
  ReceiptText,
  RotateCcw,
  ScanBarcode,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { getApprovals } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
import { useSettings } from "../../hooks/useSettings"
import type { UserPermission } from "../../types/api"
import { cn } from "../../utils/cn"

type Leaf = { to: string; label: string; icon: ComponentType<{ className?: string }>; dotColor?: string }
type Group = { id: string; label: string; icon: ComponentType<{ className?: string }>; basePath: string; children: Leaf[] }
type Item = Leaf | Group

function isGroup(item: Item): item is Group {
  return "children" in item
}

function permissionForItem(item: Item): UserPermission | null {
  if ("to" in item && item.to === "/") return null
  const path = "basePath" in item ? item.basePath : item.to
  if (path.startsWith("/inventory")) return "MANAGE_PRODUCTS"
  if (path.startsWith("/invoices") || path.startsWith("/pos") || path.startsWith("/quotations")) return "MANAGE_INVOICES"
  if (path.startsWith("/vouchers")) return "MANAGE_VOUCHERS"
  if (path.startsWith("/customers") || path.startsWith("/account")) return "MANAGE_CUSTOMERS"
  if (path.startsWith("/catalog-management")) return "MANAGE_CUSTOMERS"
  if (path.startsWith("/retail-catalog")) return "MANAGE_PRODUCTS"
  if (path.startsWith("/reports")) return "VIEW_REPORTS"
  if (path.startsWith("/settings")) return "MANAGE_SETTINGS"
  return null
}

const navItems: Item[] = [
  { to: "/", label: "الرئيسية", icon: Home },
  {
    id: "inventory",
    label: "المخزن",
    icon: Boxes,
    basePath: "/inventory",
    children: [
      { to: "/inventory", label: "المنتجات", icon: Boxes, dotColor: "#818CF8" },
      { to: "/inventory/transfers", label: "التحويلات", icon: ArrowRightLeft, dotColor: "#38BDF8" },
    ],
  },
  {
    id: "invoices",
    label: "الفواتير",
    icon: FileText,
    basePath: "/invoices",
    children: [
      { to: "/invoices?type=SALE", label: "فواتير البيع", icon: Receipt, dotColor: "#34D399" },
      { to: "/invoices?type=PURCHASE", label: "فواتير الشراء", icon: ShoppingCart, dotColor: "#FBBF24" },
      { to: "/invoices?type=SALES_RETURN", label: "مرتجع المبيعات", icon: RotateCcw, dotColor: "#F87171" },
      { to: "/invoices/returns", label: "إنشاء مرتجع", icon: RotateCcw, dotColor: "#FB7185" },
      { to: "/quotations", label: "عروض الأسعار", icon: FileCheck2, dotColor: "#60A5FA" },
    ],
  },
  { to: "/pos", label: "كاشير سريع", icon: ScanBarcode },
  {
    id: "vouchers",
    label: "السندات",
    icon: ReceiptText,
    basePath: "/vouchers",
    children: [
      { to: "/vouchers?type=RECEIPT", label: "سندات القبض", icon: ReceiptText, dotColor: "#34D399" },
      { to: "/vouchers?type=PAYMENT", label: "سندات الدفع", icon: ReceiptText, dotColor: "#FB923C" },
      { to: "/vouchers?type=EXPENSE", label: "المصاريف", icon: Wallet, dotColor: "#F87171" },
    ],
  },
  { to: "/customers", label: "الزبائن", icon: Users },
  { to: "/customers/import", label: "استيراد الزبائن", icon: UserPlus },
  { to: "/account", label: "كشف الحساب", icon: Search },
  { to: "/catalog-management", label: "الكاتلوك", icon: Globe },
  { to: "/retail-catalog", label: "كتلوك المفرد", icon: Store },
  { to: "/reports", label: "التقارير", icon: BarChart3 },
  { to: "/settings", label: "الإعدادات", icon: Settings },
]

const isSaasOwner = import.meta.env.VITE_IS_SAAS_OWNER === "true"

const adminItems = [
  { to: "/approvals", label: "الموافقات", Icon: ShieldCheck },
  ...(isSaasOwner ? [{ to: "/super-admin", label: "إدارة التراخيص", Icon: KeyRound }] : []),
]

function SideLeaf({ item, index = 0 }: { item: Leaf; index?: number }) {
  const location = useLocation()
  const isActive = (() => {
    const url = new URL(item.to, window.location.origin)
    return location.pathname === url.pathname && location.search === url.search
  })()
  const Icon = item.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
    >
      <NavLink
        to={item.to}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 relative",
          isActive
            ? "text-white"
            : "text-[var(--theme-sidebarText)] hover:bg-white/8 hover:text-[var(--theme-sidebarTextHover)]",
        )}
        style={isActive ? {
          background: "linear-gradient(135deg, rgba(99,102,241,0.30) 0%, rgba(139,92,246,0.20) 100%)",
          boxShadow: "inset 0 0 0 1px rgba(99,102,241,0.25)"
        } : {}}
      >
        {isActive && (
          <span
            className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-l-full"
            style={{ background: "linear-gradient(180deg, #818CF8, #6366F1)", boxShadow: "0 0 8px rgba(99,102,241,0.6)" }}
          />
        )}
        {item.dotColor ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full shadow-sm"
            style={{ backgroundColor: item.dotColor, boxShadow: isActive ? `0 0 6px ${item.dotColor}` : undefined }}
          />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
        {item.label}
      </NavLink>
    </motion.div>
  )
}

function SideGroup({ item, isOpen, onToggle }: { item: Group; isOpen: boolean; onToggle: (id: string) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const inGroup = location.pathname.startsWith(item.basePath)
  const open = isOpen
  const Icon = item.icon
  const openDestination = (path: string) => {
    if (location.pathname === "/invoices/new") window.open(path, "_blank", "noopener,noreferrer")
    else navigate(path)
  }

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => {
            onToggle(item.id)
            openDestination(item.id === "invoices" ? "/invoices?type=SALE" : item.basePath)
          }}
          className={cn(
            "flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-all duration-150",
            inGroup
              ? "text-white bg-white/10"
              : "text-[var(--theme-sidebarText)] hover:bg-white/6 hover:text-[var(--theme-sidebarTextHover)]",
          )}
        >
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all",
              inGroup ? "bg-[var(--theme-accent)]" : "bg-white/8"
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          {item.label}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(item.id) }}
          className="rounded-lg p-1.5 text-white/30 transition hover:text-white/70 hover:bg-white/6"
        >
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.div>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="mr-4 mt-0.5 mb-1 space-y-0.5 border-r border-white/8 pr-2 pl-1">
              {item.children.map((child, i) => (
                <SideLeaf key={child.to} item={child} index={i} />
              ))}

              {/* Quick-create buttons for invoice group */}
              {item.id === "invoices" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="flex gap-1.5 pt-1.5 pb-0.5"
                >
                  <button
                    type="button"
                    onClick={() => openDestination("/invoices/new?type=SALE")}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-2 py-1.5 text-[11px] font-semibold text-emerald-400 transition hover:border-emerald-400/50 hover:bg-emerald-500/15 hover:text-emerald-300 active:scale-95"
                  >
                    <Plus className="h-3 w-3" />
                    بيع
                  </button>
                  <button
                    type="button"
                    onClick={() => openDestination("/invoices/new?type=PURCHASE")}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2 py-1.5 text-[11px] font-semibold text-amber-400 transition hover:border-amber-400/50 hover:bg-amber-500/15 hover:text-amber-300 active:scale-95"
                  >
                    <Plus className="h-3 w-3" />
                    شراء
                  </button>
                </motion.div>
              )}

              {/* Quick-create buttons for voucher group */}
              {item.id === "vouchers" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="flex gap-1.5 pt-1.5 pb-0.5"
                >
                  <button
                    type="button"
                    onClick={() => openDestination("/vouchers?action=RECEIPT")}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-teal-500/25 bg-teal-500/8 px-2 py-1.5 text-[11px] font-semibold text-teal-400 transition hover:border-teal-400/50 hover:bg-teal-500/15 hover:text-teal-300 active:scale-95"
                  >
                    <Plus className="h-3 w-3" />
                    قبض
                  </button>
                  <button
                    type="button"
                    onClick={() => openDestination("/vouchers?action=PAYMENT")}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-orange-500/25 bg-orange-500/8 px-2 py-1.5 text-[11px] font-semibold text-orange-400 transition hover:border-orange-400/50 hover:bg-orange-500/15 hover:text-orange-300 active:scale-95"
                  >
                    <Plus className="h-3 w-3" />
                    دفع
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SideLink({
  to,
  label,
  Icon,
}: {
  to: string
  label: string
  Icon: ComponentType<{ className?: string }>
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-all duration-150",
          isActive
            ? "text-white bg-white/10"
            : "text-[var(--theme-sidebarText)] hover:bg-white/6 hover:text-[var(--theme-sidebarTextHover)]",
        )
      }
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/8">
        <Icon className="h-4 w-4" />
      </span>
      {label}
    </NavLink>
  )
}

export function Sidebar() {
  const user = useAuthStore((state) => state.user)
  const permissions = user?.permissions ?? []
  const isAdmin = user?.role === "ADMIN"
  const location = useLocation()
  const settingsQuery = useSettings()
  const settings = settingsQuery.data

  // Track which group is open — only one at a time
  const defaultOpen = navItems.find(
    (item) => isGroup(item) && location.pathname.startsWith(item.basePath)
  ) as Group | undefined
  const [openGroupId, setOpenGroupId] = useState<string | null>(defaultOpen?.id ?? null)

  function toggleGroup(id: string) {
    setOpenGroupId((prev) => (prev === id ? null : id))
  }

  const approvalsQuery = useQuery({
    queryKey: ["approvals-pending-count"],
    queryFn: () => getApprovals(),
    refetchInterval: 30_000,
    enabled: isAdmin,
  })
  const pendingCount = approvalsQuery.data?.length ?? 0

  function hasPermission(item: Item): boolean {
    if (isAdmin) return true
    const perm = permissionForItem(item)
    return perm === null || permissions.includes(perm)
  }

  const visibleItems = navItems.filter(hasPermission)

  return (
    <aside
      className="flex h-full w-[220px] flex-col"
      style={{ background: "linear-gradient(180deg, var(--theme-sidebar) 0%, #0A0F1E 100%)" }}
    >
      {/* Logo area */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4 border-b border-white/6">
        {settings?.storeLogo ? (
          <img src={settings.storeLogo} className="h-8 w-8 shrink-0 rounded-lg object-contain bg-white/10" alt="logo" />
        ) : (
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)", boxShadow: "0 0 16px rgba(99,102,241,0.4)" }}
          >
            <Zap className="h-4 w-4 text-white" />
          </div>
        )}
        <div>
          <div className="text-[14px] font-bold text-white tracking-tight">{settings?.storeName ?? "مخزوني"}</div>
          <div className="text-[10px] text-white/30 leading-none mt-0.5">Pro</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
        {visibleItems.map((item) =>
          isGroup(item) ? (
            <SideGroup key={item.id} item={item} isOpen={openGroupId === item.id} onToggle={toggleGroup} />
          ) : "to" in item && item.to === "/pos" ? (
            <button
              key="/pos"
              type="button"
              onClick={() => window.open("/pos", "_blank", "width=1024,height=768")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium text-[var(--theme-sidebarText)] transition-all duration-150 hover:bg-white/6 hover:text-[var(--theme-sidebarTextHover)]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/8">
                <ScanBarcode className="h-4 w-4" />
              </span>
              كاشير سريع
            </button>
          ) : (
            <SideLink key={item.to} to={item.to} label={item.label} Icon={item.icon} />
          ),
        )}

        {/* Admin section */}
        {isAdmin && (
          <div className="mt-3 pt-3 border-t border-white/6">
            <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/20">
              الإدارة
            </div>
            {adminItems.map((adminItem) => (
              <NavLink
                key={adminItem.to}
                to={adminItem.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-all duration-150",
                    isActive
                      ? "text-white bg-white/10"
                      : "text-[var(--theme-sidebarText)] hover:bg-white/6 hover:text-[var(--theme-sidebarTextHover)]",
                  )
                }
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/8">
                    <adminItem.Icon className="h-4 w-4" />
                  </span>
                  {adminItem.label}
                </div>
                {pendingCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      {/* Bottom gradient fade */}
      <div className="h-4 shrink-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />

      {/* Display screen shortcut */}
      <div className="shrink-0 border-t border-white/6 px-2.5 py-2">
        <button
          type="button"
          onClick={() => window.open("/display", "_blank", "noopener,noreferrer")}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-[var(--theme-sidebarText)] transition-all hover:bg-white/6 hover:text-[var(--theme-sidebarTextHover)]"
        >
          <span className="text-sm">📺</span>
          شاشة العرض
        </button>
      </div>
    </aside>
  )
}
