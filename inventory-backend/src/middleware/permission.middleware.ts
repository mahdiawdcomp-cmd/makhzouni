import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "../utils/app-error";

export function hasPermission(user: Express.User | undefined, permission: string) {
  return Boolean(user && (user.role === UserRole.ADMIN || user.permissions.includes(permission)));
}

/**
 * Profit / financial-reports visibility.
 *
 * This is the ONE capability that must be revocable even from an ADMIN (so a second
 * admin can have every other admin power yet not see profits). ADMINs bypass every
 * normal permission, so we model the revocation as an explicit DENY marker stored in
 * the user's `permissions` array. Absence of the marker = can view (backward compatible:
 * every existing admin keeps full access). Presence = hidden, for admins and staff alike.
 *
 * Staff additionally need the normal reports capability to reach the reports at all.
 */
export const HIDE_PROFIT_REPORTS = "HIDE_PROFIT_REPORTS";

export function canViewProfitReports(user: Express.User | undefined) {
  if (!user) return false;
  if (user.permissions.includes(HIDE_PROFIT_REPORTS)) return false;
  if (user.role === UserRole.ADMIN) return true;
  return user.permissions.includes("VIEW_REPORTS");
}

export function requireProfitReports() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("Authentication is required", 401, "AUTH_REQUIRED"));
    }
    if (!canViewProfitReports(req.user)) {
      return next(new AppError("عرض الأرباح والتقارير المالية غير مسموح لهذا الحساب", 403, "PROFIT_REPORTS_FORBIDDEN"));
    }
    return next();
  };
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("Authentication is required", 401, "AUTH_REQUIRED"));
    }

    if (!hasPermission(req.user, permission)) {
      return next(new AppError("Permission is required", 403, "PERMISSION_REQUIRED"));
    }

    return next();
  };
}

/** Allow access if the user has ANY of the listed permissions (OR logic). ADMINs always pass. */
export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("Authentication is required", 401, "AUTH_REQUIRED"));
    }
    if (!permissions.some((p) => hasPermission(req.user, p))) {
      return next(new AppError("Permission is required", 403, "PERMISSION_REQUIRED"));
    }
    return next();
  };
}
