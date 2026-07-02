import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Timer,
} from "lucide-react"
import { analyzeErrorLog, getErrorLogs, getSystemHealth, resolveErrorLog } from "../api/endpoints"
import type { ErrorAnalysis, ErrorLog, ErrorLogSource, HealthLevel } from "../types/api"
import { toast } from "../components/ui/use-toast"
import { cn } from "../utils/cn"

const SOURCE_LABELS: Record<ErrorLogSource, string> = {
  CAMPAIGN: "الحملات",
  WHATSAPP: "واتساب",
  CRON: "المهام المجدولة",
  BACKUP: "النسخ الاحتياطي",
  DATABASE: "قاعدة البيانات",
  API: "الخادم",
  OTHER: "أخرى",
}

const LEVEL_STYLES: Record<string, string> = {
  INFO: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  WARN: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  ERROR: "bg-red-500/10 text-red-400 border-red-500/25",
  CRITICAL: "bg-red-600/20 text-red-300 border-red-500/40",
}

const HEALTH_LABELS: Record<HealthLevel, { label: string; color: string }> = {
  ok: { label: "سليم", color: "#34D399" },
  warn: { label: "تحذير", color: "#F59E0B" },
  down: { label: "متوقف", color: "#EF4444" },
  unknown: { label: "غير معروف", color: "#94A3B8" },
}

function HealthCard({ title, level, detail, Icon }: {
  title: string
  level: HealthLevel
  detail?: string | null
  Icon: typeof Activity
}) {
  const h = HEALTH_LABELS[level]
  return (
    <div className="glass flex items-center gap-3 rounded-xl p-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${h.color}1f`, color: h.color }}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: "var(--theme-textPrimary)" }}>{title}</div>
        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: h.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: h.color }} />
          {h.label}
          {detail ? <span className="truncate opacity-70" style={{ color: "var(--theme-textSecondary)" }}> — {detail}</span> : null}
        </div>
      </div>
    </div>
  )
}

function AnalysisBox({ analysis }: { analysis: ErrorAnalysis }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-indigo-500/25 bg-indigo-500/8 p-3 text-[13px]">
      <div className="flex items-center gap-2 font-semibold text-indigo-400">
        <Bot className="h-4 w-4" />
        تحليل الذكاء الاصطناعي
      </div>
      <div><span className="font-semibold">الملخص: </span>{analysis.summary}</div>
      <div><span className="font-semibold">السبب المحتمل: </span>{analysis.likelyCause}</div>
      <div><span className="font-semibold">الحل المقترح: </span>{analysis.suggestedFix}</div>
    </div>
  )
}

export function AnalyzedErrorsPage() {
  const qc = useQueryClient()
  const [source, setSource] = useState<ErrorLogSource | "">("")
  const [includeResolved, setIncludeResolved] = useState(false)
  const [analyses, setAnalyses] = useState<Record<string, ErrorAnalysis>>({})

  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: getSystemHealth,
    refetchInterval: 60_000,
  })

  const logsQuery = useQuery({
    queryKey: ["error-logs", source, includeResolved],
    queryFn: () => getErrorLogs({ source: source || undefined, includeResolved }),
    refetchInterval: 60_000,
  })

  const resolveMutation = useMutation({
    mutationFn: resolveErrorLog,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["error-logs"] })
      toast({ title: "تم تعليم الخطأ كمُعالج" })
    },
    onError: () => toast({ title: "تعذّر تعليم الخطأ", variant: "destructive" }),
  })

  const analyzeMutation = useMutation({
    mutationFn: analyzeErrorLog,
    onSuccess: (analysis, id) => {
      if (analysis) setAnalyses((prev) => ({ ...prev, [id]: analysis }))
    },
    onError: () => toast({ title: "تعذّر تحليل الخطأ", variant: "destructive" }),
  })

  const health = healthQuery.data
  const rows: ErrorLog[] = logsQuery.data?.rows ?? []
  const aiEnabled = logsQuery.data?.aiEnabled ?? false

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold" style={{ color: "var(--theme-textPrimary)" }}>
          صحة النظام والأخطاء
        </h1>
        <button
          type="button"
          onClick={() => {
            void healthQuery.refetch()
            void logsQuery.refetch()
          }}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] font-medium transition hover:bg-white/6"
          style={{ color: "var(--theme-textSecondary)" }}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (healthQuery.isFetching || logsQuery.isFetching) && "animate-spin")} />
          تحديث
        </button>
      </div>

      {/* Health overview */}
      {health && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <HealthCard title="قاعدة البيانات" level={health.db.level} Icon={Database}
            detail={health.db.latencyMs != null ? `${health.db.latencyMs}ms` : null} />
          <HealthCard title="واتساب" level={health.whatsapp.level} Icon={MessageCircle}
            detail={health.whatsapp.detail ?? health.whatsapp.provider} />
          <HealthCard title="الحملات" level={health.campaigns.level} Icon={Send}
            detail={`جارية: ${health.campaigns.running} — فشل 24س: ${health.campaigns.failed24h}`} />
          <HealthCard title="المهام المجدولة" level={health.cron.level} Icon={Timer}
            detail={health.cron.ageSec != null ? `آخر دورة قبل ${Math.round(health.cron.ageSec / 60)} دقيقة` : null} />
          <HealthCard title="النسخ الاحتياطي" level={health.backup.level} Icon={Activity}
            detail={health.backup.detail} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as ErrorLogSource | "")}
          className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-[13px]"
          style={{ color: "var(--theme-textPrimary)", backgroundColor: "var(--theme-cardBg)" }}
        >
          <option value="">كل المصادر</option>
          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--theme-textSecondary)" }}>
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          عرض المُعالَجة أيضاً
        </label>
      </div>

      {/* Error list */}
      {logsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin opacity-50" />
        </div>
      ) : rows.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 rounded-xl py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <div className="text-[14px] font-medium" style={{ color: "var(--theme-textPrimary)" }}>
            لا توجد أخطاء {includeResolved ? "" : "غير مُعالَجة"} 🎉
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((log) => {
            const analysis = analyses[log.id]
            const analyzing = analyzeMutation.isPending && analyzeMutation.variables === log.id
            return (
              <div key={log.id} className="glass rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", LEVEL_STYLES[log.level] ?? LEVEL_STYLES.ERROR)}>
                      {log.level}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[11px] font-medium" style={{ color: "var(--theme-textSecondary)" }}>
                      {SOURCE_LABELS[log.source] ?? log.source}
                    </span>
                    {log.code && (
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-mono" style={{ color: "var(--theme-textSecondary)" }}>
                        {log.code}
                      </span>
                    )}
                    {log.count > 1 && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-400">
                        ×{log.count}
                      </span>
                    )}
                    {log.resolvedAt && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        مُعالَج
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px]" style={{ color: "var(--theme-textSecondary)" }}>
                    {new Date(log.lastSeenAt).toLocaleString("ar-IQ")}
                  </div>
                </div>

                <div className="mt-2 break-words text-[13.5px] leading-relaxed" style={{ color: "var(--theme-textPrimary)" }} dir="ltr">
                  {log.message}
                </div>

                {analysis && <AnalysisBox analysis={analysis} />}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {aiEnabled && !analysis && (
                    <button
                      type="button"
                      disabled={analyzing}
                      onClick={() => analyzeMutation.mutate(log.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-[12.5px] font-semibold text-indigo-400 transition hover:bg-indigo-500/20 disabled:opacity-50"
                    >
                      {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                      تحليل بالذكاء الاصطناعي
                    </button>
                  )}
                  {!log.resolvedAt && (
                    <button
                      type="button"
                      disabled={resolveMutation.isPending}
                      onClick={() => resolveMutation.mutate(log.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      تعليم كمُعالَج
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!aiEnabled && rows.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[12.5px] text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          التحليل بالذكاء الاصطناعي غير مفعّل — أضف مفتاح API في إعدادات الخادم لتفعيله.
        </div>
      )}
    </div>
  )
}
