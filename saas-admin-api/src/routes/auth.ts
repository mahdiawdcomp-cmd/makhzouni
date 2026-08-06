import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import prisma from "../prisma";
import { requireAdminAuth } from "../middleware/admin-auth";
import {
  generateTotpSecret, verifyTotp, buildOtpauthUri,
  generateRecoveryCodes, hashRecoveryCodes, consumeRecoveryCode,
} from "../services/totp.service";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totpCode: z.string().trim().optional(),
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

router.post("/login", async (req: Request, res: Response) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "username and password required" });
    return;
  }
  const { username, password, totpCode } = body.data;
  const ip = req.ip;

  const admin = await prisma.adminUser.findUnique({ where: { username } });

  // Per-username lockout, independent of the per-IP rate limiter in
  // server.ts — that one alone doesn't stop an attacker spreading guesses
  // across many IPs against the one account that controls every tenant.
  if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
    await prisma.adminLoginLog.create({ data: { username, success: false, reason: "LOCKED", ip } });
    res.status(423).json({
      error: "ACCOUNT_LOCKED",
      message: `الحساب موقوف مؤقتاً بعد محاولات فاشلة متكررة. حاول بعد ${LOCKOUT_MINUTES} دقيقة.`,
    });
    return;
  }

  const valid = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
  if (!admin || !valid) {
    if (admin) {
      const failedLoginCount = admin.failedLoginCount + 1;
      const lockedUntil = failedLoginCount >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60000)
        : null;
      await prisma.adminUser.update({ where: { id: admin.id }, data: { failedLoginCount, lockedUntil } });
    }
    await prisma.adminLoginLog.create({ data: { username, success: false, reason: "BAD_CREDENTIALS", ip } });
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // TOTP is opt-in (totpEnabled defaults to false) — only gate the login on
  // it for an account that has actually completed enrollment.
  if (admin.totpEnabled) {
    if (!totpCode) {
      res.status(401).json({ error: "TOTP_REQUIRED", message: "أدخل رمز التحقق بخطوتين." });
      return;
    }
    const codeOk = admin.totpSecret ? verifyTotp(admin.totpSecret, totpCode) : false;
    if (!codeOk) {
      const { matched, remaining } = await consumeRecoveryCode(admin.recoveryCodes, totpCode);
      if (!matched) {
        await prisma.adminLoginLog.create({ data: { username, success: false, reason: "INVALID_TOTP", ip } });
        res.status(401).json({ error: "INVALID_TOTP", message: "رمز التحقق غير صحيح." });
        return;
      }
      // Recovery code accepted — burn it so it can't be reused.
      await prisma.adminUser.update({ where: { id: admin.id }, data: { recoveryCodes: remaining } });
    }
  }

  await prisma.adminUser.update({ where: { id: admin.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await prisma.adminLoginLog.create({ data: { username, success: true, reason: null, ip } });

  const token = jwt.sign({ adminId: admin.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

// Lets an authenticated admin review recent login activity for this account
// instead of that data only being reachable via direct DB access.
router.get("/login-log", requireAdminAuth, async (_req: Request, res: Response) => {
  const logs = await prisma.adminLoginLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  res.json(logs);
});

router.get("/totp/status", requireAdminAuth, async (req: Request, res: Response) => {
  const adminId = (req as any).adminId as string | null;
  if (!adminId) {
    res.status(403).json({ error: "SERVICE_TOKEN_NOT_ALLOWED" });
    return;
  }
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) {
    res.status(404).json({ error: "ADMIN_NOT_FOUND" });
    return;
  }
  res.json({ totpEnabled: admin.totpEnabled, recoveryCodesRemaining: admin.recoveryCodes.length });
});

// Step 1 of enrollment: generate a new (not-yet-active) secret and return it
// for the admin to add to their authenticator app. totpEnabled stays false
// until /totp/verify-enroll confirms the app actually produces matching
// codes — never enable 2FA on an unverified secret, since that could lock
// the only admin account out permanently.
router.post("/totp/enroll", requireAdminAuth, async (req: Request, res: Response) => {
  const adminId = (req as any).adminId as string | null;
  if (!adminId) {
    res.status(403).json({ error: "SERVICE_TOKEN_NOT_ALLOWED" });
    return;
  }
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) {
    res.status(404).json({ error: "ADMIN_NOT_FOUND" });
    return;
  }
  if (admin.totpEnabled) {
    res.status(409).json({ error: "TOTP_ALREADY_ENABLED" });
    return;
  }
  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { id: admin.id }, data: { totpSecret: secret } });
  res.json({ secret, otpauthUri: buildOtpauthUri(secret, admin.username) });
});

const verifyEnrollSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

// Step 2 of enrollment: prove the authenticator app is actually producing
// valid codes before flipping totpEnabled on. Returns the plaintext recovery
// codes exactly once — only bcrypt hashes are persisted.
router.post("/totp/verify-enroll", requireAdminAuth, async (req: Request, res: Response) => {
  const adminId = (req as any).adminId as string | null;
  if (!adminId) {
    res.status(403).json({ error: "SERVICE_TOKEN_NOT_ALLOWED" });
    return;
  }
  const parsed = verifyEnrollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin?.totpSecret) {
    res.status(409).json({ error: "NO_PENDING_ENROLLMENT", message: "شغّل خطوة التفعيل أولاً." });
    return;
  }
  if (!verifyTotp(admin.totpSecret, parsed.data.code)) {
    res.status(401).json({ error: "INVALID_TOTP" });
    return;
  }
  const recoveryCodes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(recoveryCodes);
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { totpEnabled: true, recoveryCodes: hashed },
  });
  res.json({ enabled: true, recoveryCodes });
});

const disableTotpSchema = z.object({ password: z.string().min(1) });

// Disabling 2FA is a security-reducing action, so it requires the account
// password again, not just the existing session token.
router.post("/totp/disable", requireAdminAuth, async (req: Request, res: Response) => {
  const adminId = (req as any).adminId as string | null;
  if (!adminId) {
    res.status(403).json({ error: "SERVICE_TOKEN_NOT_ALLOWED" });
    return;
  }
  const parsed = disableTotpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) {
    res.status(404).json({ error: "ADMIN_NOT_FOUND" });
    return;
  }
  const valid = await bcrypt.compare(parsed.data.password, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { totpEnabled: false, totpSecret: null, recoveryCodes: [] },
  });
  res.json({ enabled: false });
});

export default router;
