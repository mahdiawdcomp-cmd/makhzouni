import { Lock } from "lucide-react"
import { Link } from "react-router-dom"

export type LockedFeatureReason = "feature" | "platform"

const REASON_TEXT: Record<LockedFeatureReason, string> = {
  feature: "هذه الميزة غير مفعلة في نسختك. تواصل مع الدعم لتفعيلها.",
  platform: "هذه المنصّة غير مفعلة لهذا الحساب. تواصل مع الدعم لتفعيلها.",
}

/**
 * Batch 4 — shown instead of a page/route when its required feature or
 * platform is disabled for the current SaaS tenant. Visual only: it does not
 * call or block any API — the backend still serves the route's data if
 * requested directly.
 */
export function LockedFeaturePage({
  featureLabel,
  reason = "feature",
}: {
  featureLabel: string
  reason?: LockedFeatureReason
}) {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: "rgba(99,102,241,0.12)" }}
      >
        <Lock className="h-7 w-7" style={{ color: "var(--theme-accent, #6366F1)" }} />
      </div>
      <h1 className="text-lg font-bold" style={{ color: "var(--theme-textPrimary)" }}>
        {featureLabel}
      </h1>
      <p className="max-w-sm text-sm" style={{ color: "var(--theme-textSecondary)" }}>
        {REASON_TEXT[reason]}
      </p>
      <Link
        to="/"
        className="mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        style={{ background: "var(--theme-accent, #6366F1)" }}
      >
        الرجوع للرئيسية
      </Link>
    </div>
  )
}
