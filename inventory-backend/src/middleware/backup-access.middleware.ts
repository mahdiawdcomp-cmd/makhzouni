import { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { adminOnly } from "./admin-only.middleware";
import { authMiddleware } from "./auth.middleware";

/**
 * Batch 13D — gates the secret-or-admin endpoints. Allows either:
 *   A) ?secret= / X-Backup-Secret matching BACKUP_SECRET exactly (external
 *      scripts, which run with the app closed and hold no session), or
 *   B) an authenticated admin session (authMiddleware + adminOnly — the
 *      in-app buttons, which send a JWT and no secret).
 * Fails closed (401 UNAUTHORIZED_BACKUP_ACCESS) unless one of the two holds;
 * never reveals which check failed.
 *
 * Lived inline in settings.routes.ts until the nightly «الكشف العام» export
 * needed the same door from reports.routes.ts. Shared rather than copied: two
 * hand-copied constant-time comparisons drift, and this one guards the whole
 * database.
 */
export function backupSecretMatches(req: Request): boolean {
  const envSecret = process.env.BACKUP_SECRET ?? "";
  if (!envSecret) return false;
  // Header first — the query form is retained for the existing scheduled
  // scripts, but it puts the full-database secret into every access log, so
  // the header is the documented way and the URL is masked by requestLogger.
  const headerValue = req.headers["x-backup-secret"];
  const provided = String(
    (Array.isArray(headerValue) ? headerValue[0] : headerValue) ?? req.query.secret ?? "",
  );
  if (!provided) return false;
  // Constant-time compare so the secret cannot be recovered byte by byte.
  const expectedBuf = Buffer.from(envSecret);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function allowBackupAccess(req: Request, res: Response, next: NextFunction) {
  if (backupSecretMatches(req)) {
    next();
    return;
  }

  let authorized = false;
  await new Promise<void>((resolve) => {
    authMiddleware(req, res, (err?: unknown) => {
      if (err) { resolve(); return; }
      adminOnly(req, res, (err2?: unknown) => {
        authorized = !err2;
        resolve();
      });
    });
  });

  if (authorized) {
    next();
    return;
  }
  res.status(401).json({ success: false, error: "UNAUTHORIZED_BACKUP_ACCESS" });
}
