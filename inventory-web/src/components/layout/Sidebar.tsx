import { useState, type ComponentType } from "react"
import { NavLink, useLocation, useNavigate } from "react-router-dom"
import {
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Home,
  Receipt,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  Wallet,
  ArrowRightLeft,
  Zap,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { getApprovals } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
import { cn } from "../../utils/cn"

type Leaf  = { to: string; label: string; icon: ComponentType<{ className?: string }>; dotColor?: string }
type Group = { id: string; label: string; icon: ComponentType<{ className?: string }>; basePath: string; children: Leaf[] }
type Item  = Leaf | Group

function isGroup(item: Item): item is Group { return "children" in item }

const navItems: Item[] = [
  { to: "/",          label: "الرئيسية",    icon: Home },
  {
    id: "inventory", label: "المخزن", icon: Boxes, basePath: "/inventory",
    children: [
      { to: "/inventory",           label: "المنتجات",    icon: Boxes,           dotColor: "#8B5CF6" },
      { to: "/inventory/transfers", label: "التحويلات",   icon: ArrowRightLeft,  dotColor: "#0EA5E9" },
    ],
  },
  {
    id: "invoices", label: "الفواتير", icon: FileText, basePath: "/invoices",
    children: [
      { to: "/invoices?type=SALE",     label: "فواتير البيع",   icon: Receipt,      dotColor: "#16A34A" },
      { to: "/invoices?type=PURCHASE", label: "فواتير الشراء",  icon: ShoppingCart, dotColor: "#D97706" },
    ],
  },
  {
    id: "vouchers", label: "السندات", icon: ReceiptText, basePath: "/vouchers",
    children: [
      { to: "/vouchers?type=RECEIPT", label: "سندات القبض", icon: ReceiptText, dotColor: "#059669" },
      { to: "/vouchers?type=PAYMENT", label: "سندات الدفع", icon: ReceiptText, dotColor: "#EA580C" },
      { to: "/vouchers?type=EXPENSE", label: "المصاريف",    icon: Wallet,      dotColor: "#DC2626" },
    ],
  },
  { to: "/customers", label: "الزبائن",      icon: Users    },
  { to: "/account",   label: "كشف الحساب",   icon: Search   },
  { to: "/reports",   label: "التقارير",      icon: BarChart3 },
  { to: "/settings",  label: "الإعدادات",     icon: Settings  },
]

const adminItems = [
  { to: "/users",      label: "المستخدمين",  Icon: Users        },
  { to: "/approvals",  label: "الموافقات",   Icon: ShieldCheck  },
  { to: "/audit-logs", label: "سجل التدقيق", Icon: ClipboardList },
  { to: "/branches",   label: "الفروع",      Icon: Building2    },
]

/* ── Sidebar leaf link ── */
function SideLeaf({ item }: { item: Leaf }) {
  const location = useLocation()
  const isActive = (() => {
    try {
      const url = new URL(item.to, window.location.origin)
      return location.pathname === url.pathname && location.search === url.search
    } catch { return false }
  })()
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-100",
        isActive
          ? "text-white"
          : "text-[var(--theme-sidebarText)] hover:bg-white/8 hover:text-white"
      )}
      style={isActive ? { backgroundColor: "rgba(0,110,234,0.85)" } : {}}
    >
      {item.dotColor
        ? <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: item.dotColor }} />
        : <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />}
      {item.label}
    </NavLink>
  )
}

/* ── Sidebar group ── */
function SideGroup({ item, pendingCount }: { item: Group; pendingCount?: number }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const inGroup = location.pathname.startsWith(item.basePath)
  const [open, setOpen] = useState(inGroup)
  const Icon = item.icon

  function handleClick() {
    setOpen(true)
    navigate(item.basePath)
  }

  return (
    <div>
      <div className="flex items-center">
        {/* Main clickable area — navigates to group root */}
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "flex flex-1 items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-all duration-100",
            inGroup
              ? "text-white bg-white/10"
              : "text-[var(--theme-sidebarText)] hover:bg-white/8 hover:text-white"
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {item.label}
          {pendingCount ? (
            <span className="rounded-full bg-[var(--theme-accent)] px-1.5 py-0.5 text-[10px] text-white leading-none">
              {pendingCount}
            </span>
          ) : null}
        </button>
        {/* Chevron — only toggles the submenu */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
          className="rounded-md p-1.5 text-white/40 hover:text-white/80 transition"
        >
          {open
            ? <ChevronDown className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open ? (
        <div className="mt-0.5 ml-3 mr-2 space-y-0.5 rounded-md border-r border-white/10 pl-1 pr-2">
          {item.children.map((child) => (
            <SideLeaf key={child.to} item={child} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ── Top-level nav link ── */
function SideLink({ to, label, Icon, badge }: {
  to: string; label: string; Icon: ComponentType<{ className?: string }>; badge?: number
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-[13.5px] font-medium transition-all duration-100",
          isActive
            ? "bg-[var(--theme-accent)] text-white shadow-sm"
            : "text-[var(--theme-sidebarText)] hover:bg-white/8 hover:text-white"
        )
      }
    >
      <span className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </span>
      {badge ? (
        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white leading-none">
          {badge}
        </span>
      ) : null}
    </NavLink>
  )
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   MAIN SIDEBAR
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export function Sidebar() {
  const isAdmin = useAuthStore((state) => state.isAdmin())
  const { data: approvals = [] } = useQuery({
    queryKey: ["approvals", "badge"],
    queryFn: getApprovals,
    enabled: isAdmin,
    refetchInterval: 30_000,
  })

  return (
    <aside
      className="flex h-full w-[230px] shrink-0 flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--theme-sidebar)",
        borderLeft: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* ── Brand ── */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/8">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
          style={{ backgroundColor: "var(--theme-accent)" }}
        >
          <Zap className="h-4 w-4 text-white" />
        </div>
        <div>
          <div className="text-[15px] font-bold text-white leading-none">مخزوني</div>
          <div className="text-[10.5px] text-white/40 mt-0.5 leading-none">Inventory ERP</div>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.map((item) =>
          isGroup(item) ? (
            <SideGroup key={item.id} item={item} />
          ) : (
            <SideLink key={item.to} to={item.to} label={item.label} Icon={item.icon} />
          )
        )}

        {/* ── Admin Section ── */}
        {isAdmin ? (
          <div className="mt-4 pt-4 border-t border-white/8">
            <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
              إدارة النظام
            </div>
            {adminItems.map(({ to, label, Icon }) => (
              <SideLink
                key={to}
                to={to}
                label={label}
                Icon={Icon}
                badge={to === "/approvals" && approvals.length > 0 ? approvals.length : undefined}
              />
            ))}
          </div>
        ) : null}
      </nav>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-white/8">
        <div className="text-[10.5px] text-white/25 text-center">
          مخزوني v1.0 — ERP System
        </div>
      </div>
    </aside>
  )
}
