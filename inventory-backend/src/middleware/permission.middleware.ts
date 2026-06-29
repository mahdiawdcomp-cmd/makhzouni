import { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "../utils/app-error";

export function hasPermission(user: Express.User | undefined, permission: string) {
  return Boolean(user && (user.role === UserRole.ADMIN || user.permissions.includes(permission)));
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
