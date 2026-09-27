import webpush from "web-push";
import prisma from "../config/database";
import { getVapidPublicKey } from "../utils/push-notify";
import { getAnthropicClient } from "../utils/anthropic-client";
import { publishRealtimeChange } from "./realtime.service";

// «شاشة التجهيز» — the sale invoice the cashier is typing right now, relayed to
// the upstairs monitor (every invoice) and — only when the cashier presses
// «أرسل للتجهيز» — to the prep workers' phones, with a push. Workers report
// back per line (ready ✔ / short ❗ + how many found), acknowledge receipt,
// and mark the whole order ready. Unacknowledged orders re-ring.
//
// Each shop runs its own backend, so this in-memory state is per-tenant by
// construction. It is a live mirror only: a restart empties it until the
// cashier's next keystroke. Nothing here is a business record (the «who
// prepared» names are saved with the invoice lines by the cashier's page).

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
  /** One id per order (the cashier mints a new one per invoice). */
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

export interface PrepSent {
  at: number;
  by: string;
  urgent: boolean;
  note: string | null;
  /** Urdu translation of the note for the workers (null until/unless translated). */
  noteUr: string | null;
  /** null = every worker holding PREP_NOTIFY. */
  targetUserId: string | null;
  targetName: string | null;
  ack: { by: string; at: number } | null;
  reminders: number;
  lastPushAt: number;
}

export interface PrepOrder {
  snapshot: PrepSnapshot;
  statuses: Record<string, LineStatus>;
  ready: { by: string; at: number } | null;
  sent: PrepSent | null;
  cancelled: { by: string; at: number } | null;
}

const MAX_ORDERS = 20;
const ORDER_TTL_MS = 3 * 60 * 60 * 1000;
const REMIND_AFTER_MS = 2 * 60 * 1000;
const MAX_REMINDERS = 3;

let live: PrepSnapshot | null = null;
// Insertion-ordered: oldest first. Re-inserted on every update.
const orders = new Map<string, PrepOrder>();

function prune() {
  const cutoff = Date.now() - ORDER_TTL_MS;
  for (const [id, o] of orders) if (o.snapshot.updatedAt < cutoff) orders.delete(id);
  // Over the cap: drop orders nobody was asked to prepare first, then the oldest.
  for (const [id, o] of orders) {
    if (orders.size <= MAX_ORDERS) break;
    if (!o.sent) orders.delete(id);
  }
  while (orders.size > MAX_ORDERS) orders.delete(orders.keys().next().value as string);
}

function changed() {
  publishRealtimeChange({ resource: "prep-screen", action: "updated" });
}

// Live typing arrives per keystroke — announce it at most once a second
// (trailing), so open screens refetch the prep state, not hammer it.
let liveTimer: NodeJS.Timeout | null = null;
function liveChanged() {
  if (liveTimer) return;
  liveTimer = setTimeout(() => { liveTimer = null; changed(); }, 1000);
  liveTimer.unref?.();
}

export function getPrepState() {
  prune();
  return { live, orders: [...orders.values()].reverse() };
}

function upsertOrder(snapshot: PrepSnapshot) {
  const existing = orders.get(snapshot.draftId);
  orders.delete(snapshot.draftId);
  const order: PrepOrder = {
    snapshot,
    statuses: existing?.statuses ?? {},
    ready: existing?.ready ?? null,
    sent: existing?.sent ?? null,
    cancelled: existing?.cancelled ?? null,
  };
  orders.set(snapshot.draftId, order);
  return order;
}

export function setPrepLive(next: PrepSnapshot) {
  // Two cashier tabs can race; never let an older snapshot overwrite a newer one.
  if (live && live.draftId === next.draftId && next.updatedAt < live.updatedAt) return getPrepState();
  live = next;
  // Keep every order with lines (the monitor shows them all), and keep a sent
  // order in sync even if the cashier removed every line.
  if (next.lines.length > 0 || orders.get(next.draftId)?.sent) upsertOrder(next);
  prune();
  liveChanged();
  return getPrepState();
}

export function markPrepLine(orderId: string, key: string, status: { state: "done" | "short"; found?: number } | null, by: string) {
  const order = orders.get(orderId);
  if (!order) return false;
  if (status) order.statuses[key] = { ...status, by, at: Date.now() };
  else delete order.statuses[key];
  // Doing work on an order is receiving it.
  if (order.sent && !order.sent.ack) order.sent.ack = { by, at: Date.now() };
  changed();
  return true;
}

export function markPrepReady(orderId: string, ready: boolean, by: string) {
  const order = orders.get(orderId);
  if (!order) return false;
  order.ready = ready ? { by, at: Date.now() } : null;
  if (ready && order.sent && !order.sent.ack) order.sent.ack = { by, at: Date.now() };
  changed();
  return true;
}

// ── «أرسل للتجهيز» ─────────────────────────────────────────────────────────

export async function sendPrepOrder(
  snapshot: PrepSnapshot,
  opts: { urgent: boolean; note: string | null; targetUserId: string | null },
  by: string,
) {
  if (live?.draftId === snapshot.draftId && snapshot.updatedAt < live.updatedAt) snapshot = live;
  else live = snapshot;
  const order = upsertOrder(snapshot);
  const note = opts.note?.trim() || null;
  let targetName: string | null = null;
  if (opts.targetUserId) {
    const u = await prisma.user.findUnique({ where: { id: opts.targetUserId }, select: { name: true } });
    targetName = u?.name ?? null;
  }
  const now = Date.now();
  order.cancelled = null;
  order.sent = {
    at: now,
    by,
    urgent: opts.urgent,
    note,
    noteUr: order.sent?.note === note ? order.sent.noteUr : null,
    targetUserId: opts.targetUserId,
    targetName,
    ack: null,
    reminders: 0,
    lastPushAt: now,
  };
  changed();
  void pushToWorkers(order, opts.urgent ? "🔥 URGENT ORDER" : "🔔 NEW ORDER");
  if (note && !order.sent.noteUr) void translateNote(order.snapshot.draftId, note);
  return getPrepState();
}

export function ackPrepOrder(orderId: string, by: string) {
  const order = orders.get(orderId);
  if (!order?.sent) return false;
  if (!order.sent.ack) order.sent.ack = { by, at: Date.now() };
  changed();
  return true;
}

export function cancelPrepOrder(orderId: string, by: string) {
  const order = orders.get(orderId);
  if (!order?.sent) return false;
  order.cancelled = { by, at: Date.now() };
  changed();
  void pushToWorkers(order, "❌ ORDER CANCELLED", "Stop preparing this order");
  return true;
}

export async function listPrepWorkers() {
  return prisma.user.findMany({
    where: { isActive: true, permissions: { has: PREP_NOTIFY } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function translateNote(orderId: string, note: string) {
  const client = getAnthropicClient();
  if (!client) return;
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: "Translate the shop owner's note (Iraqi Arabic) for Pakistani warehouse workers into short, simple Urdu (Urdu script). Output ONLY the translation.",
      messages: [{ role: "user", content: note }],
    });
    const text = msg.content.map((b) => ("text" in b ? b.text : "")).join("").trim();
    const order = orders.get(orderId);
    if (text && order?.sent && order.sent.note === note) {
      order.sent.noteUr = text;
      changed();
    }
  } catch {
    // No translation — the workers still see the original note.
  }
}

// Unacknowledged sent orders ring again every 2 minutes, up to 3 times.
const reminderTimer = setInterval(() => {
  const now = Date.now();
  for (const order of orders.values()) {
    const s = order.sent;
    if (!s || s.ack || order.cancelled || order.ready) continue;
    if (s.reminders >= MAX_REMINDERS || now - s.lastPushAt < REMIND_AFTER_MS) continue;
    s.reminders += 1;
    s.lastPushAt = now;
    void pushToWorkers(order, s.urgent ? "🔥⏰ URGENT — NOT RECEIVED" : "⏰ ORDER WAITING");
  }
}, 30_000);
reminderTimer.unref?.();

// ── Web Push ───────────────────────────────────────────────────────────────

async function pushToWorkers(order: PrepOrder, title: string, body?: string) {
  const pub = getVapidPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!pub || !priv) return;
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? "mailto:admin@mazbwoni.com", pub, priv);

  // Explicit holders only — an ADMIN passes every permission by role, but the
  // owner does not want his own phone ringing for every order.
  const target = order.sent?.targetUserId ?? null;
  const users = await prisma.user.findMany({
    where: { isActive: true, permissions: { has: PREP_NOTIFY }, ...(target ? { id: target } : {}) },
    select: { id: true },
  });
  if (users.length === 0) return;
  const subs = await prisma.staffPushSubscription.findMany({ where: { userId: { in: users.map((u) => u.id) } } });

  const first = order.snapshot.lines[0];
  const count = order.snapshot.lines.length;
  const payload = JSON.stringify({
    title,
    body: body ?? `${count} ITEM${count === 1 ? "" : "S"}${order.sent?.note ? " • 📝 NOTE" : ""} — tap to open`,
    url: "/prep",
    image: first?.imageUrl && /^https?:\/\//.test(first.imageUrl) ? first.imageUrl : undefined,
    tag: `prep-${order.snapshot.draftId}`,
    staff: true,
  });

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription as unknown as webpush.PushSubscription, payload, {
        TTL: 600,
        urgency: "high",
      });
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
