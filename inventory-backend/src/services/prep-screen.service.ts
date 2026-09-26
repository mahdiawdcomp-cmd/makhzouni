import webpush from "web-push";
import prisma from "../config/database";
import { getVapidPublicKey } from "../utils/push-notify";
import { publishRealtimeChange } from "./realtime.service";

// «شاشة التجهيز» — the sale invoice the cashier is typing right now, relayed to
// the prep workers' phones, plus what the workers report back per line
// (ready ✔ / short ❗ with how many they found) and per order (all ready).
// Each shop runs its own backend, so this in-memory state is per-tenant by
// construction. It is a live mirror only: a restart empties it until the
// cashier's next keystroke. Nothing here is a business record.

export const PREP_NOTIFY = "PREP_NOTIFY";

export interface PrepLine {
  key: string;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unit: "PIECE" | "DOZEN" | "BOX" | "CARTON";
  notes?: string;
}

export interface PrepSnapshot {
  /** One id per order (the cashier mints a new one when a fresh invoice gets its first line). */
  draftId: string;
  customerName: string | null;
  lines: PrepLine[];
  updatedAt: number;
}

export interface LineStatus {
  state: "done" | "short";
  /** For «short»: how many the worker actually found (0 = none at all). */
  found?: number;
  by: string;
  at: number;
}

export interface PrepOrder {
  snapshot: PrepSnapshot;
  statuses: Record<string, LineStatus>;
  ready: { by: string; at: number } | null;
}

const MAX_ORDERS = 15;
const ORDER_TTL_MS = 3 * 60 * 60 * 1000;

let live: PrepSnapshot | null = null;
// Insertion-ordered: oldest first. Re-inserted on every update.
const orders = new Map<string, PrepOrder>();

function prune() {
  const cutoff = Date.now() - ORDER_TTL_MS;
  for (const [id, o] of orders) if (o.snapshot.updatedAt < cutoff) orders.delete(id);
  while (orders.size > MAX_ORDERS) orders.delete(orders.keys().next().value as string);
}

function changed() {
  publishRealtimeChange({ resource: "prep-screen", action: "updated" });
}

export function getPrepState() {
  prune();
  return { live, orders: [...orders.values()].reverse() };
}

export function setPrepLive(next: PrepSnapshot) {
  // Two cashier tabs can race; never let an older snapshot overwrite a newer one.
  if (live && live.draftId === next.draftId && next.updatedAt < live.updatedAt) return getPrepState();
  live = next;

  if (next.lines.length > 0) {
    const existing = orders.get(next.draftId);
    orders.delete(next.draftId);
    orders.set(next.draftId, { snapshot: next, statuses: existing?.statuses ?? {}, ready: existing?.ready ?? null });
    // A brand-new order id with lines = the cashier just started a sale → one push.
    if (!existing) void notifyPrepStaff(next);
  }
  prune();
  changed();
  return getPrepState();
}

export function markPrepLine(orderId: string, key: string, status: { state: "done" | "short"; found?: number } | null, by: string) {
  const order = orders.get(orderId);
  if (!order) return false;
  if (status) order.statuses[key] = { ...status, by, at: Date.now() };
  else delete order.statuses[key];
  changed();
  return true;
}

export function markPrepReady(orderId: string, ready: boolean, by: string) {
  const order = orders.get(orderId);
  if (!order) return false;
  order.ready = ready ? { by, at: Date.now() } : null;
  changed();
  return true;
}

async function notifyPrepStaff(snapshot: PrepSnapshot) {
  const pub = getVapidPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!pub || !priv) return;
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? "mailto:admin@mazbwoni.com", pub, priv);

  // Explicit holders only — an ADMIN passes every permission by role, but the
  // owner does not want his own phone ringing for every sale.
  const users = await prisma.user.findMany({
    where: { isActive: true, permissions: { has: PREP_NOTIFY } },
    select: { id: true },
  });
  if (users.length === 0) return;
  const subs = await prisma.staffPushSubscription.findMany({ where: { userId: { in: users.map((u) => u.id) } } });

  const first = snapshot.lines[0];
  const payload = JSON.stringify({
    title: "🔔 NEW ORDER",
    body: "Open the prep screen",
    url: "/prep",
    image: first?.imageUrl && /^https?:\/\//.test(first.imageUrl) ? first.imageUrl : undefined,
    tag: "prep-order",
    staff: true,
  });

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription as unknown as webpush.PushSubscription, payload, { TTL: 600, urgency: "high" });
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await prisma.staffPushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  }));
}

export async function saveStaffSubscription(userId: string, subscription: { endpoint: string }) {
  return prisma.staffPushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: { userId, endpoint: subscription.endpoint, subscription: subscription as object },
    update: { userId, subscription: subscription as object },
  });
}

export async function removeStaffSubscription(userId: string, endpoint: string) {
  await prisma.staffPushSubscription.deleteMany({ where: { userId, endpoint } });
}
