import { createHmac, randomBytes } from "crypto";
import bcrypt from "bcrypt";

/**
 * RFC 6238 TOTP, implemented natively (no otplib/speakeasy dependency) —
 * this is short enough to keep in-repo and review directly rather than
 * trust a third-party package for the one thing that gates the only
 * account that controls every tenant.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Accepts the current 30s window and one step on either side, to tolerate clock drift. */
export function verifyTotp(secretBase32: string, token: string, windowSteps = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  for (let i = -windowSteps; i <= windowSteps; i++) {
    if (hotp(secret, counter + i) === token) return true;
  }
  return false;
}

export function buildOtpauthUri(secretBase32: string, username: string): string {
  const issuer = "Makhzouni Super Admin";
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
}

/** Checks `candidate` against the stored hashes; returns the remaining hash list with the matched one removed (single-use). */
export async function consumeRecoveryCode(
  hashedCodes: string[],
  candidate: string,
): Promise<{ matched: boolean; remaining: string[] }> {
  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(candidate, hashedCodes[i])) {
      const remaining = [...hashedCodes];
      remaining.splice(i, 1);
      return { matched: true, remaining };
    }
  }
  return { matched: false, remaining: hashedCodes };
}
