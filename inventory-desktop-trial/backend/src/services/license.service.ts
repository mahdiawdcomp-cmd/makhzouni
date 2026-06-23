import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";

// Public key embedded in source — private key stays with the developer only.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqKaERt4biq18LfItHzd0
V+kr8phpHK44UICl/+ZIvFCEdwC9Dk6fatfk2zDoitCzmRlmgRGyWrAuWI3pINel
RNsWgKJ0AT+oCWHrSogNPEB2rLWE4flY6AuciaZyY3qG5JEoQj1FWHC0oncUzKXv
TKCtz3KsgUKiv/pgt8iXRdiHOSybmsFqtMivgfpzU1VaYschi4bdkLJeR884/dnV
vWfNmgJRfGb7MEg6dk+PB6MLCMTlOcyT7w6wAVpx8mPHshHv2+MfW1JoGlVDNbfz
Sa4+IBxkntKSlKVGYePC4h/5TAMggrvyCWLLLE11qy7V+cQhWk9LxnbTbkU2mC/C
HQIDAQAB
-----END PUBLIC KEY-----`;

export type LicenseStatus = "valid" | "expiring" | "expired" | "missing" | "invalid";

export interface LicenseInfo {
  status: LicenseStatus;
  clientId: string | null;
  clientName: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  gracePeriodEndsAt: string | null;  // 30 days after expiry
  readOnlyMode: boolean;
}

const GRACE_DAYS = 30;
const EXPIRY_WARNING_DAYS = 30;

let _cached: LicenseInfo | null = null;

export function verifyLicense(): LicenseInfo {
  if (_cached) return _cached;

  const key = process.env.LICENSE_KEY?.trim();

  if (!key) {
    const info: LicenseInfo = {
      status: "missing",
      clientId: null,
      clientName: null,
      expiresAt: null,
      daysLeft: null,
      gracePeriodEndsAt: null,
      readOnlyMode: false, // No key = dev/trial mode, still functional
    };
    _cached = info;
    logger.warn("[license] LICENSE_KEY not set — running in unlicensed mode");
    return info;
  }

  try {
    const payload = jwt.verify(key, LICENSE_PUBLIC_KEY, { algorithms: ["RS256"] }) as {
      sub?: string;
      name?: string;
      exp?: number;
    };

    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp ?? 0;
    const daysLeft = Math.floor((exp - now) / 86400);
    const expiresAt = new Date(exp * 1000).toISOString();
    const gracePeriodEndsAt = new Date((exp + GRACE_DAYS * 86400) * 1000).toISOString();

    let status: LicenseStatus;
    let readOnlyMode = false;

    if (daysLeft > EXPIRY_WARNING_DAYS) {
      status = "valid";
    } else if (daysLeft > 0) {
      status = "expiring";
    } else if (daysLeft > -GRACE_DAYS) {
      status = "expired";
      // Grace period: system still fully functional but banner shows
    } else {
      status = "expired";
      readOnlyMode = true; // Beyond grace → write ops blocked
    }

    const info: LicenseInfo = {
      status,
      clientId: payload.sub ?? null,
      clientName: payload.name ?? null,
      expiresAt,
      daysLeft,
      gracePeriodEndsAt,
      readOnlyMode,
    };

    _cached = info;
    logger.info(`[license] Client: ${info.clientName} | Status: ${status} | Days left: ${daysLeft}`);
    return info;

  } catch (err) {
    const info: LicenseInfo = {
      status: "invalid",
      clientId: null,
      clientName: null,
      expiresAt: null,
      daysLeft: null,
      gracePeriodEndsAt: null,
      readOnlyMode: false,
    };
    _cached = info;
    logger.error("[license] Invalid LICENSE_KEY:", err instanceof Error ? err.message : err);
    return info;
  }
}

/** Call this to bust the cache (e.g. after env reload) */
export function resetLicenseCache() {
  _cached = null;
}
