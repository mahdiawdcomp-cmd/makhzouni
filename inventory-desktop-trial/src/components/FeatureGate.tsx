import type { ReactNode } from "react"
import { useFeatureEnabled, usePlatformEnabled } from "../hooks/useTenantConfig"
import { LockedFeaturePage } from "./LockedFeaturePage"

/**
 * Batch 4 — wraps a route element so that when the current SaaS tenant
 * doesn't have `featureKey` enabled, a LockedFeaturePage renders instead.
 * Standalone mode (no TENANT_ID, e.g. mahdi today) always passes through
 * unchanged. Visual only — never touches any API call.
 */
export function FeatureGate({
  featureKey,
  label,
  children,
}: {
  featureKey: string
  label: string
  children: ReactNode
}) {
  const enabled = useFeatureEnabled(featureKey)
  if (!enabled) return <LockedFeaturePage featureLabel={label} reason="feature" />
  return <>{children}</>
}

/** Same idea, gated by a platform flag (web/android/desktop) instead of a feature key. */
export function PlatformGate({
  platform,
  label,
  children,
}: {
  platform: "web" | "android" | "desktop"
  label: string
  children: ReactNode
}) {
  const enabled = usePlatformEnabled(platform)
  if (!enabled) return <LockedFeaturePage featureLabel={label} reason="platform" />
  return <>{children}</>
}
