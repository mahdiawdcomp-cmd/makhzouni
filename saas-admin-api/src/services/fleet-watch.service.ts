/**
 * Periodic fleet check.
 *
 * Until now nothing in this service ever ran on its own — every check happened
 * only when an admin clicked something. That is why a shop could sit outside
 * the control plane for months, and why a subscription could lapse with no
 * warning: the panel had no way to notice anything, it could only answer
 * questions it was asked.
 *
 * This runs one read-only sweep on an interval and keeps the answer in memory:
 *   - is each shop actually reading its licence from us, or running standalone?
 *   - is it in read-only mode when we do not expect it to be?
 *   - is its licence expired, or expiring soon?
 *
 * Deliberately in-memory: the alternative is a schema migration for state that
 * is re-derivable in seconds, and a stale row that outlives a restart is worse
 * than no row. A restart just means the first sweep has not landed yet, which
 * the API reports honestly rather than papering over.
 */
import { isSafeOutboundUrl } from "../routes/tenants";
import prisma from "../prisma";

export type FleetState = "connected" | "disconnected" | "unknown";

export interface FleetRow {
  tenantId: string;
  state: FleetState;
  /** True when the shop reports it is refusing writes. */
  readOnly?: boolean;
  /** Why we could not tell — unreachable, bad status, unparseable body. */
  reason?: string;
  /** Days until the licence expires; negative once it already has. */
  daysToExpiry?: number | null;
}

export interface FleetSnapshot {
  checkedAt: string | null;
  rows: FleetRow[];
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 6000;
/** Probe in small waves so a large fleet cannot open hundreds of sockets at once. */
const PROBE_CONCURRENCY = 8;

let snapshot: FleetSnapshot = { checkedAt: null, rows: [] };
let sweeping = false;
let timer: NodeJS.Timeout | null = null;

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((date.getTime() - Date.now()) / 86400000);
}

async function probe(tenant: { id: string; backendUrl: string; expiresAt: Date | null }): Promise<FleetRow> {
  const daysToExpiry = daysUntil(tenant.expiresAt);
  if (!tenant.backendUrl || !isSafeOutboundUrl(tenant.backendUrl)) {
    return { tenantId: tenant.id, state: "unknown", reason: "رابط الباكند غير صالح", daysToExpiry };
  }
  try {
    const response = await fetch(`${tenant.backendUrl.replace(/\/+$/, "")}/api/tenant-info`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { tenantId: tenant.id, state: "unknown", reason: `HTTP ${response.status}`, daysToExpiry };
    }
    const info = await response.json() as { mode?: string; readOnly?: boolean };
    return {
      tenantId: tenant.id,
      state: info.mode === "standalone" ? "disconnected" : "connected",
      readOnly: !!info.readOnly,
      daysToExpiry,
    };
  } catch (error) {
    return {
      tenantId: tenant.id,
      state: "unknown",
      reason: error instanceof Error ? error.message : "تعذر الاتصال",
      daysToExpiry,
    };
  }
}

/** One read-only pass over every shop. Never throws; never writes to the DB. */
export async function sweepFleet(): Promise<FleetSnapshot> {
  if (sweeping) return snapshot;
  sweeping = true;
  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, backendUrl: true, expiresAt: true },
    });

    const rows: FleetRow[] = [];
    for (let i = 0; i < tenants.length; i += PROBE_CONCURRENCY) {
      rows.push(...await Promise.all(tenants.slice(i, i + PROBE_CONCURRENCY).map(probe)));
    }
    snapshot = { checkedAt: new Date().toISOString(), rows };

    // One line per problem, so an operator reading logs sees the same things
    // the panel shows without having to open it.
    for (const row of rows) {
      if (row.state === "disconnected") {
        console.warn(`[fleet] tenant ${row.tenantId} is running standalone — nothing in Super Admin reaches it`);
      }
      if (row.readOnly) {
        console.warn(`[fleet] tenant ${row.tenantId} is in read-only mode — it cannot sell`);
      }
      if (typeof row.daysToExpiry === "number" && row.daysToExpiry <= 7) {
        console.warn(`[fleet] tenant ${row.tenantId} licence ${row.daysToExpiry < 0 ? "expired" : "expires in " + row.daysToExpiry + "d"}`);
      }
    }
    return snapshot;
  } catch (error) {
    console.warn(`[fleet] sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    return snapshot;
  } finally {
    sweeping = false;
  }
}

export function getFleetSnapshot(): FleetSnapshot {
  return snapshot;
}

/** Starts the recurring sweep. Safe to call once at boot; idempotent. */
export function startFleetWatch(): void {
  if (timer) return;
  // A first sweep at boot would compete with startup work and delay the health
  // check, so give the process a moment to settle first.
  setTimeout(() => { void sweepFleet(); }, 15_000);
  timer = setInterval(() => { void sweepFleet(); }, SWEEP_INTERVAL_MS);
  // Never hold the process open on this alone.
  timer.unref?.();
  console.log(`[fleet] watching every ${SWEEP_INTERVAL_MS / 60000} minutes`);
}
