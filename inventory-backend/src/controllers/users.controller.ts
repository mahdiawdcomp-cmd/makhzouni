import { UserRole } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  createUser,
  deactivateUser,
  deleteUserPermanently,
  listUsers,
  updateUser,
} from "../services/user.service";
import { hasPermission } from "../middleware/permission.middleware";
import prisma from "../config/database";

function ensureAuthenticatedUser(reqUser: Express.User | undefined) {
  if (!reqUser) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  return reqUser;
}

// MANAGE_USERS is an ordinary, UI-grantable permission — it must not be a path
// to becoming ADMIN. Without these guards a STAFF holder could PUT their own
// record with {"role":"ADMIN"} and take over the tenant, then permanently
// delete every real admin. Role assignment and any action against an ADMIN
// target are therefore ADMIN-only, and a non-admin can never hand out a
// permission they do not themselves hold.
function assertMayAssignRole(actor: Express.User, body: unknown) {
  const role = (body as { role?: unknown } | null)?.role;
  if (role === undefined) return;
  if (actor.role !== UserRole.ADMIN) {
    throw new AppError(
      "تغيير الدور مسموح للمدير فقط",
      403,
      "ROLE_CHANGE_ADMIN_ONLY"
    );
  }
}

function assertMayAssignPermissions(actor: Express.User, body: unknown) {
  const permissions = (body as { permissions?: unknown } | null)?.permissions;
  if (!Array.isArray(permissions)) return;
  if (actor.role === UserRole.ADMIN) return;
  const escalated = (permissions as string[]).filter(
    (permission) => !hasPermission(actor, permission)
  );
  if (escalated.length > 0) {
    throw new AppError(
      `لا يمكنك منح صلاحيات لا تملكها: ${escalated.join(", ")}`,
      403,
      "PERMISSION_ESCALATION"
    );
  }
}

async function assertMayTargetUser(actor: Express.User, targetId: string) {
  if (actor.role === UserRole.ADMIN) return;
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { role: true },
  });
  if (target?.role === UserRole.ADMIN) {
    throw new AppError(
      "لا يمكن تعديل أو حذف حساب مدير إلا من قبل مدير",
      403,
      "TARGET_IS_ADMIN"
    );
  }
}

async function queueStaffApproval(
  requestType: keyof typeof approvalRequestTypes,
  requestData: Record<string, unknown>,
  requestedBy: string
) {
  const approval = await createPendingApproval(
    approvalRequestTypes[requestType],
    requestData,
    requestedBy
  );

  return {
    success: true,
    message: "طلبك قيد المراجعة",
    approvalId: approval.id,
  };
}

export const getUsers = asyncHandler(async (_req, res) => {
  const users = await listUsers();

  res.json({
    success: true,
    data: users,
  });
});

export const addUser = asyncHandler(async (req, res) => {
  const user = ensureAuthenticatedUser(req.user);
  assertMayAssignRole(user, req.body);
  assertMayAssignPermissions(user, req.body);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_USERS")) {
    const response = await queueStaffApproval(
      "CREATE_USER",
      { body: req.body },
      user.id
    );
    res.status(202).json(response);
    return;
  }

  const createdUser = await createUser(req.body);

  res.status(201).json({
    success: true,
    message: "User created successfully",
    data: createdUser,
  });
});

export const editUser = asyncHandler(async (req, res) => {
  const user = ensureAuthenticatedUser(req.user);
  const id = String(req.params.id);
  assertMayAssignRole(user, req.body);
  assertMayAssignPermissions(user, req.body);
  await assertMayTargetUser(user, id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_USERS")) {
    const response = await queueStaffApproval(
      "UPDATE_USER",
      { params: { id }, body: req.body },
      user.id
    );
    res.status(202).json(response);
    return;
  }

  const updatedUser = await updateUser(id, req.body);

  res.json({
    success: true,
    message: "User updated successfully",
    data: updatedUser,
  });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = ensureAuthenticatedUser(req.user);
  const id = String(req.params.id);
  await assertMayTargetUser(user, id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_USERS")) {
    const response = await queueStaffApproval(
      "DEACTIVATE_USER",
      { params: { id } },
      user.id
    );
    res.status(202).json(response);
    return;
  }

  const deactivatedUser = await deactivateUser(id, user.id);

  res.json({
    success: true,
    message: "User deactivated successfully",
    data: deactivatedUser,
  });
});

export const permanentlyDeleteUser = asyncHandler(async (req, res) => {
  const user = ensureAuthenticatedUser(req.user);
  const id = String(req.params.id);
  await assertMayTargetUser(user, id);

  await deleteUserPermanently(id, user.id);

  res.json({
    success: true,
    message: "User deleted permanently",
  });
});
