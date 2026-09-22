/**
 * «المندوب» — the page's short names for the shared rep components, and the
 * «جاري التحميل / ما في اتصال» placeholder every list uses.
 */

import { QueryErrorBox } from "../../components/ui/query-error"
import { AgentDialog, AgentEmptyState, AgentField, AgentLoading, AgentStatusPill } from "./shared"

// One definition for the whole rep experience, including the new screens, in
// `sales-agent/shared.tsx`. Aliased here so every existing call site is
// untouched by the move.
export const Dialog = AgentDialog

export const Field = AgentField

export const EmptyState = AgentEmptyState

export const Loading = AgentLoading

export const StatusPill = AgentStatusPill

/* ── data hooks ──────────────────────────────────────────────────────── */

// TanStack pauses a retry when the browser reports itself offline or the tab
// loses focus: the query stays `pending` with `fetchStatus: "paused"` and
// nothing moves again on its own. Outdoors on a weak signal that is the rep's
// normal state, so it gets a message and a button instead of a spinner that
// never stops.
export function Waiting({ q }: { q: { fetchStatus: string; refetch: () => unknown } }) {
  if (q.fetchStatus === "paused") {
    return <QueryErrorBox title="ما في اتصال" onRetry={() => void q.refetch()} />
  }
  return <Loading />
}
