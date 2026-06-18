import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { adminId: string };
    (req as any).adminId = payload.adminId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
