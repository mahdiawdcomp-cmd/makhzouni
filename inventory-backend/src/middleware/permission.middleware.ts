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

/**
 * «المندوب» — the travelling sales rep.
 *
 * Deliberately a capability string on an ordinary STAFF user, not a new role:
 * `User.permissions` is an open String[] built for exactly this, and every
 * role check in the codebase already understands ADMIN/STAFF. A third enum
 * member would have to be taught to all of them.
 *
 * Note the asymmetry with every other capability: `hasPermission` lets an ADMIN
 * through unconditionally, which is right for powers, but SALES_AGENT is a
 * RESTRICTION as much as a power — it confines a user to their own customers.
 * An owner must not be silently confined to a rep's customer list, so this one
 * is tested by literal membership.
 */
export const SALES_AGENT = "SALES_AGENT";

export function isSalesAgent(user: Express.User | undefined) {
  return Boolean(user && user.permissions.includes(SALES_AGENT));
}

/**
 * The id a query must filter customers by, or null for "no restriction".
 *
 * An ADMIN who also carries the SALES_AGENT marker is still scoped — the marker
 * is the owner's explicit statement that this account is a rep. Owners simply
 * do not carry it.
 */
export function salesAgentScopeFor(user: Express.User | undefined): string | null {
  return isSalesAgent(user) ? (user?.id ?? null) : null;
}

/** Route guard: only a user carrying the rep marker may pass. */
export function requireSalesAgent() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("Authentication is required", 401, "AUTH_REQUIRED"));
    }
    if (!isSalesAgent(req.user)) {
      return next(new AppError("هذي الشاشة للمندوب فقط", 403, "SALES_AGENT_REQUIRED"));
    }
    return next();
  };
}

/**
 * Confine a rep to their own customers on EVERY `:id` route of a router.
 *
 * Wired with `router.param("id", ...)`, so it runs for every existing route
 * carrying `:id` and for every route added later — the detail page, the balance,
 * the transactions, the statement. A per-handler check would have to be
 * remembered each time someone adds an endpoint, and the one that gets forgotten
 * is the one that leaks another rep's customer.
 *
 * A customer that exists but is not theirs answers 404, not 403: a 403 confirms
 * the id belongs to a real customer of the shop, which is itself something a rep
 * should not be able to probe for.
 */
export function scopeCustomerParamToSalesAgent() {
  return async (req: Request, _res: Response, next: NextFunction, id: string) => {
    try {
      const scope = salesAgentScopeFor(req.user);
      if (!scope) return next();

      const prisma = (await import("../config/database")).default;
      const owned = await prisma.customer.findFirst({
        where: { id, salesAgentId: scope },
        select: { id: true },
      });
      if (!owned) {
        return next(new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND"));
      }
      return next();
    } catch (err) {
      return next(err);
    }
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
