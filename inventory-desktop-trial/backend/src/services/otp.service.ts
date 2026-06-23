type OtpRecord = {
  code: string;
  expiresAt: number;
  attempts: number;
  requestCount: number;
  windowStart: number;
};

const store = new Map<string, OtpRecord>();
const verified = new Map<string, number>();

const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 3;
const OTP_TTL = 5 * 60_000;
const WINDOW = 60 * 60_000;
const VERIFIED_TTL = 24 * 60 * 60_000;

function clean() {
  const now = Date.now();
  for (const [k, v] of store) if (now > v.expiresAt + 2 * 60_000) store.delete(k);
  for (const [k, v] of verified) if (now > v) verified.delete(k);
}

export function canSendOtp(phone: string): boolean {
  clean();
  const rec = store.get(phone);
  if (!rec) return true;
  if (Date.now() - rec.windowStart > WINDOW) return true;
  return rec.requestCount < MAX_PER_HOUR;
}

export function generateOtp(phone: string): string {
  clean();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Date.now();
  const rec = store.get(phone);
  const sameWindow = rec && now - rec.windowStart < WINDOW;
  store.set(phone, {
    code,
    expiresAt: now + OTP_TTL,
    attempts: 0,
    requestCount: sameWindow ? rec.requestCount + 1 : 1,
    windowStart: sameWindow ? rec.windowStart : now,
  });
  return code;
}

export function verifyOtp(phone: string, code: string): boolean {
  const rec = store.get(phone);
  if (!rec) return false;
  if (Date.now() > rec.expiresAt) { store.delete(phone); return false; }
  rec.attempts++;
  if (rec.attempts > MAX_ATTEMPTS) { store.delete(phone); return false; }
  if (rec.code !== code.trim()) return false;
  store.delete(phone);
  return true;
}

export function markVerified(phone: string) {
  verified.set(phone, Date.now() + VERIFIED_TTL);
}

export function isVerified(phone: string): boolean {
  const exp = verified.get(phone);
  if (!exp) return false;
  if (Date.now() > exp) { verified.delete(phone); return false; }
  return true;
}
