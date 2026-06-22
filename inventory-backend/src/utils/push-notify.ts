import webpush from "web-push";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_EMAIL = process.env.VAPID_EMAIL ?? "mailto:admin@mazbwoni.com";

let initialized = false;

function init() {
  if (initialized || !VAPID_PUBLIC || !VAPID_PRIVATE) return;
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  initialized = true;
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC;
}

export async function sendPushNotification(
  subscription: webpush.PushSubscription,
  payload: { title: string; body: string; url?: string }
) {
  init();
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch {
    // Expired or invalid subscription — ignore silently
  }
}
