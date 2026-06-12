import bcrypt from "bcrypt";
import { Prisma, UserRole } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  permissions: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export const userPermissions = [
  "MANAGE_USERS",
  "MANAGE_APPROVALS",
  "MANAGE_PRODUCTS",
  "MANAGE_CUSTOMERS",
  "MANAGE_INVOICES",
  "MANAGE_VOUCHERS",
  "VIEW_REPORTS",
  "MANAGE_SETTINGS",
] as const;

export type UserPermission = (typeof userPermissions)[number];

export interface CreateUserInput {
  name: string;
  username: string;
  password: string;
  role?: UserRole;
  permissions?: UserPermission[];
  isActive?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  username?: string;
  password?: string;
  role?: UserRole;
  permissions?: UserPermission[];
  isActive?: boolean;
}

function getSaltRounds() {
  return Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);
}

function normalizePermissions(role: UserRole | undefined, permissions: UserPermission[] | undefined) {
  if (role === UserRole.ADMIN) return [...userPermissions];
  return Array.from(new Set(permissions ?? []));
}

export async function listUsers() {
  return prisma.user.findMany({
    where: { deletedAt: null },
    select: userSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function createUser(input: CreateUserInput, db: Db = prisma) {
  const passwordHash = await bcrypt.hash(input.password, getSaltRounds());

  return db.user.create({
    data: {
      name: input.name,
      username: input.username,
      passwordHash,
      role: input.role ?? UserRole.STAFF,
      permissions: normalizePermissions(input.role ?? UserRole.STAFF, input.permissions),
      isActive: input.isActive ?? true,
    },
    select: userSelect,
  });
}

export async function updateUser(id: string, input: UpdateUserInput, db: Db = prisma) {
  const data: Prisma.UserUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.username !== undefined) data.username = input.username;
  if (input.role !== undefined) data.role = input.role;
  if (input.role !== undefined || input.permissions !== undefined) {
    data.permissions = normalizePermissions(input.role, input.permissions);
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password !== undefined) {
    data.passwordHash = await bcrypt.hash(input.password, getSaltRounds());
  }

  return db.user.update({
    where: { id },
    data,
    select: userSelect,
  });
}

export async function deactivateUser(
  id: string,
  currentUserId?: string,
  db: Db = prisma
) {
  if (id === currentUserId) {
    throw new AppError("You cannot deactivate your own user", 400, "SELF_DEACTIVATE");
  }

  return db.user.update({
    where: { id },
    data: { isActive: false },
    select: userSelect,
  });
}

export async function deleteUserPermanently(
  id: string,
  currentUserId?: string,
  db: Db = prisma
) {
  if (id === currentUserId) {
    throw new AppError("You cannot delete your own user", 400, "SELF_DELETE");
  }

  const [
    products,
    invoices,
    paymentVouchers,
    requestedApprovals,
    reviewedApprovals,
    auditLogs,
    branches,
    transfers,
    coupons,
    quotations,
  ] = await Promise.all([
    db.product.count({ where: { createdBy: id } }),
    db.invoice.count({ where: { createdBy: id } }),
    db.paymentVoucher.count({ where: { createdBy: id } }),
    db.pendingApproval.count({ where: { requestedBy: id } }),
    db.pendingApproval.count({ where: { reviewedBy: id } }),
    db.auditLog.count({ where: { userId: id } }),
    db.branch.count({ where: { createdBy: id } }),
    db.inventoryTransfer.count({ where: { createdBy: id } }),
    db.coupon.count({ where: { createdBy: id } }),
    db.quotation.count({ where: { createdBy: id } }),
  ]);

  const hasHistory =
    products +
      invoices +
      paymentVouchers +
      requestedApprovals +
      reviewedApprovals +
      auditLogs +
      branches +
      transfers +
      coupons +
      quotations >
    0;

  if (hasHistory) {
    // Soft-delete: keeps name on invoices/products but hides user from the list
    await db.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return;
  }

  try {
    await db.user.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      // Fallback: soft-delete if a FK we didn't count still exists
      await db.user.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return;
    }
    throw error;
  }
}
