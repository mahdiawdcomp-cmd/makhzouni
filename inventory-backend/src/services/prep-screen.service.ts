import webpush from "web-push";
import prisma from "../config/database";
import { getVapidPublicKey } from "../utils/push-notify";
import { publishRealtimeChange } from "./realtime.service";

// «شاشة التجهيز» — the sale invoice the cashier is typing right now, relayed to
// the prep workers' phones. Each shop runs its own backend, so this in-memory
// slot is per-tenant by construction. It is a live mirror only (a restart just
// empties it until the cashier's next keystroke); nothing here is a record.

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
  draftId: string;
  customerName: string | null;
  lines: PrepLine[];
  updatedAt: number;
}

let live: PrepSnapshot | null = null;
// Last draft we already pushed for — one push per invoice, not one per line.
let notifiedDraftId: string | null = null;

export function getPrepLive() {
  return live;
}

export function setPrepLive(next: PrepSnapshot) {
  // Two cashier tabs can race; never let an older snapshot overwrite a newer one.
  if (live && live.draftId === next.draftId && next.updatedAt < live.updatedAt) return live;
  const prev = live;
  live = next;
  publishRealtimeChange({ resource: "prep-screen", action: "updated" });

  const startsOrder = next.lines.length > 0 && (!prev || prev.lines.length === 0 || prev.draftId !== next.draftId);
  if (next.lines.length === 0 && prev?.draftId === next.draftId) notifiedDraftId = null;
  if (startsOrder && notifiedDraftId !== next.draftId) {
    notifiedDraftId = next.draftId;
    void notifyPrepStaff(next);
  }
  return live;
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
