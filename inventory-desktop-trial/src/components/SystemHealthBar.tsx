import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Activity, X } from "lucide-react"
import { getSystemHealth } from "../api/endpoints"
import { useAuthStore } from "../store/authStore"
import type { HealthLevel, SystemHealth } from "../types/api"

const CHECK_LABELS: Record<string, string> = {
  db: "قاعدة البيانات",
  whatsapp: "واتساب",
  campaigns: "الحملات",
  cron: "المهام المجدولة",
  backup: "النسخ الاحتياطي",
}

const LEVEL_COLORS: Record<HealthLevel, string> = {
  ok: "#34D399",
  warn: "#F59E0B",
  down: "#EF4444",
  unknown: "#94A3B8",
}

function worstLevel(health: SystemHealth): HealthLevel {
  const levels: HealthLevel[] = [
    health.db.level,
    health.whatsapp.level,
    health.campaigns.level,
    health.cron.level,
    health.backup.level,
  ]
  if (levels.includes("down")) return "down"
  if (levels.includes("warn")) return "warn"
  return "ok"
}

/** Thin status strip under the header. Hidden while everything is healthy;
 *  appears (for every logged-in user) as soon as any subsystem is warn/down. */
export function SystemHealthBar() {
  const token = useAuthStore((s) => s.token)
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN")
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)

  const { data: health } = useQuery({
    queryKey: ["system-health"],
    queryFn: getSystemHealth,
    refetchInterval: 60_000,
    staleTime: 55_000,
    enabled: Boolean(token),
  })

  if (!health) return null
  const worst = worstLevel(health)
  if (worst === "ok") return null
  if (dismissedAt === health.checkedAt) return null

  const entries = (["db", "whatsapp", "campaigns", "cron", "backup"] as const)
    .map((key) => ({ key, level: health[key].level }))
    .filter((e) => e.level === "warn" || e.level === "down")

  const color = LEVEL_COLORS[worst]

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-1.5 text-[12.5px] font-medium"
      style={{
        background: worst === "down" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
        borderBottom: `1px solid ${worst === "down" ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.25)"}`,
        color,
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Activity className="h-3.5 w-3.5 shrink-0" />
        {entries.map((e) => (
          <span key={e.key} className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: LEVEL_COLORS[e.level] }}
            />
            {CHECK_LABELS[e.key]}
            {e.level === "down" ? " — متوقف" : " — تحذير"}
          </span>
        ))}
        {isAdmin && (
          <Link to="/error-logs" className="underline underline-offset-2 opacity-80 hover:opacity-100">
            عرض الأخطاء
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissedAt(health.checkedAt)}
        className="opacity-60 hover:opacity-100"
        aria-label="إخفاء"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
