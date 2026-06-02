import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "../utils/app-error";

export function adminOnly(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new AppError("Authentication is required", 401, "AUTH_REQUIRED"));
  }

  if (req.user.role !== UserRole.ADMIN) {
    return next(new AppError("Admin access is required", 403, "ADMIN_ONLY"));
  }

  return next();
}
