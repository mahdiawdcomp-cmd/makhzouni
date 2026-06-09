import { useState, type ComponentType } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import {
  ArrowRightLeft,
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FileText,
  Globe,
  Home,
  Receipt,
  ReceiptText,
  RotateCcw,
  ScanBarcode,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  Zap,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { getApprovals } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
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
      { to: "/inventory", label: "المنتجات", icon: Boxes, dotColor: "#8B5CF6" },
      { to: "/inventory/transfers", label: "التحويلات", icon: ArrowRightLeft, dotColor: "#0EA5E9" },
    ],
  },
  {
    id: "invoices",
    label: "الفواتير",
    icon: FileText,
    basePath: "/invoices",
    children: [
      { to: "/invoices?type=SALE", label: "فواتير البيع", icon: Receipt, dotColor: "#16A34A" },
      { to: "/invoices?type=PURCHASE", label: "فواتير الشراء", icon: ShoppingCart, dotColor: "#D97706" },
      { to: "/invoices?type=SALES_RETURN", label: "مرتجع المبيعات", icon: RotateCcw, dotColor: "#DC2626" },
      { to: "/invoices/returns", label: "إنشاء مرتجع", icon: RotateCcw, dotColor: "#F43F5E" },
      { to: "/quotations", label: "عروض الأسعار", icon: FileCheck2, dotColor: "#2563EB" },
    ],
  },
  { to: "/pos", label: "POS سريع", icon: ScanBarcode },
  {
    id: "vouchers",
    label: "السندات",
    icon: ReceiptText,
    basePath: "/vouchers",
    children: [
      { to: "/vouchers?type=RECEIPT", label: "سندات القبض", icon: ReceiptText, dotColor: "#059669" },
      { to: "/vouchers?type=PAYMENT", label: "سندات الدفع", icon: ReceiptText, dotColor: "#EA580C" },
      { to: "/vouchers?type=EXPENSE", label: "المصاريف", icon: Wallet, dotColor: "#DC2626" },
    ],
  },
  { to: "/customers", label: "الزبائن", icon: Users },
  { to: "/account", label: "كشف الحساب", icon: Search },
  { to: "/catalog-management", label: "الكاتلوك", icon: Globe },
  { to: "/reports", label: "التقارير", icon: BarChart3 },
  { to: "/settings", label: "الإعدادات", icon: Settings },
]

const adminItems = [
  { to: "/approvals", label: "الموافقات", Icon: ShieldCheck },
]

function SideLeaf({ item }: { item: Leaf }) {
  const location = useLocation()
  const isActive = (() => {
    const url = new URL(item.to, window.location.origin)
    return location.pathname === url.pathname && location.search === url.search
  })()
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-100",
        isActive ? "text-white" : "text-[var(--theme-sidebarText)] hover:bg-white/8 hover:text-white",
      )}
      style={isActive ? { backgroundColor: "rgba(0,110,234,0.85)" } : {}}
    >
      {item.dotColor ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.dotColor }} />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
      )}
      {item.label}
    </NavLink>
  )
}

function SideGroup({ item }: { item: Group }) {
  const location = useLocation()
  const navigate = useNavigate()
  const inGroup = location.pathname.startsWith(item.basePath)
  const [open, setOpen] = useState(inGroup)
  const Icon = item.icon

  return (
    <div>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            navigate(item.id === "invoices" ? "/invoices?type=SALE" : item.basePath)
          }}
          className={cn(
            "flex flex-1 items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-all duration-100",
            inGroup ? "bg-white/10 text-white" : "text-[var(--theme-sidebarText)] hover:bg-white/8 hover:text-white",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
          className="rounded-md p-1.5 text-white/40 transition hover:text-white/80"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open ? (
        <div className="ml-3 mr-2 mt-0.5 space-y-0.5 rounded-md border-r border-white/10 pl-1 pr-2">
          {item.children.map((child) => (
            <SideLeaf key={child.to} item={child} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SideLink({
  to,
  label,
  Icon,
  badge,
}: {
  to: string
  label: string
  Icon: ComponentType<{ className?: string }>
  badge?: number
}) {
  if (to === "/pos") {
    return (
      <button
        type="button"
        onClick={() => window.open("/pos", "_blank", "noopener,noreferrer")}
        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium text-[var(--theme-sidebarText)] transition-all duration-100 hover:bg-white/8 hover:text-white"
      >
        <span className="flex items-center gap-3">
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </span>
      </button>
    )
  }

  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-all duration-100",
          isActive
            ? "bg-[var(--theme-accent)] text-white shadow-sm"
            : "text-[var(--theme-sidebarText)] hover:bg-white/8 hover:text-white",
        )
      }
    >
      <span className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </span>
      {badge ? <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] leading-none text-white">{badge}</span> : null}
    </NavLink>
  )
}

export function Sidebar() {
  const isAdmin = useAuthStore((state) => state.isAdmin())
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canManageApprovals = useAuthStore((state) => state.hasPermission("MANAGE_APPROVALS"))
  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", "badge"],
    queryFn: getApprovals,
    enabled: isAdmin || canManageApprovals,
    refetchInterval: 30_000,
  })

  const visibleAdminItems = adminItems.filter((item) => {
    if (item.to === "/approvals") return isAdmin || canManageApprovals
    return isAdmin
  })
  const visibleNavItems = navItems.filter((item) => {
    const permission = permissionForItem(item)
    return !permission || isAdmin || hasPermission(permission)
  })

  return (
    <aside
      className="flex h-full w-[230px] shrink-0 flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--theme-sidebar)",
        borderLeft: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--theme-accent)" }}>
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div>
          <div className="text-[15px] font-bold leading-none text-white">مخزوني</div>
          <div className="mt-0.5 text-[10.5px] leading-none text-white/40">Inventory ERP</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {visibleNavItems.map((item) =>
          isGroup(item) ? <SideGroup key={item.id} item={item} /> : <SideLink key={item.to} to={item.to} label={item.label} Icon={item.icon} />,
        )}

        {visibleAdminItems.length > 0 ? (
          <div className="mt-4 border-t border-white/8 pt-4">
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">إدارة النظام</div>
            {visibleAdminItems.map(({ to, label, Icon }) => (
              <SideLink key={to} to={to} label={label} Icon={Icon} badge={to === "/approvals" && approvals.length > 0 ? approvals.length : undefined} />
            ))}
          </div>
        ) : null}
      </nav>

      <div className="border-t border-white/8 px-4 py-3">
        <div className="text-center text-[10.5px] text-white/25">مخزوني v1.0 - ERP System</div>
      </div>
    </aside>
  )
}
