import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const serviceKey = process.env.SUPER_ADMIN_API_KEY;
  if (serviceKey && safeEqual(token, serviceKey)) {
    (req as any).adminId = null;
    (req as any).serviceAuth = true;
    next();
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { adminId: string };
    (req as any).adminId = payload.adminId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
