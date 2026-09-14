/**
 * When an outbound message must not be attempted, and when a failed one must
 * not be retried.
 *
 * Two different questions, both answered here so every caller agrees:
 *
 * 1. `externalSendsBlocked()` — are we in a run where nothing may leave the
 *    process at all? Tests are: a test that sends a WhatsApp message to a
 *    number out of the shop's settings is sending to a REAL phone, and a test
 *    that schedules a retry keeps timers alive after the suite finishes (they
 *    then query a database the teardown already dropped). Opt back in with
 *    `ALLOW_TEST_EXTERNAL_SENDS=true` if a test genuinely needs the real path.
 *
 * 2. `isPermanentSendFailure()` — is this failure worth retrying? «WhatsApp is
 *    disabled» is not a hiccup: it is a setting, and it will be just as
 *    disabled in three seconds, in eight, and in thirty. Retrying it burns four
 *    timers per message and logs four warnings that look like an outage.
 *
 * Production behaviour is deliberately unchanged except for that second point:
 * a real network or provider error still retries exactly as before.
 */

/** Codes that describe a CONFIGURATION state, not a transient failure. */
const PERMANENT_CODES = new Set([
  "WHATSAPP_DISABLED",
  "WHATSAPP_MANUAL_ONLY",
  "WHATSAPP_CLOUD_NOT_CONFIGURED",
  "WHATSAPP_TEST_MODE",
]);

export function externalSendsBlocked(): boolean {
  if (process.env.ALLOW_TEST_EXTERNAL_SENDS === "true") return false;
  return process.env.NODE_ENV === "test";
}

export function isPermanentSendFailure(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string" && PERMANENT_CODES.has(code)) return true;
  // Older throw sites carry the reason only in the message.
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /WhatsApp is disabled|الواتساب معطّل|لا يوجد إرسال تلقائي/.test(message);
}
