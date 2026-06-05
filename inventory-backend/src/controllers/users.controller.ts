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

function ensureAuthenticatedUser(reqUser: Express.User | undefined) {
  if (!reqUser) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  return reqUser;
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

  await deleteUserPermanently(id, user.id);

  res.json({
    success: true,
    message: "User deleted permanently",
  });
});
