import bcrypt from "bcrypt";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import { signToken } from "../utils/jwt";
import { sanitizeUser } from "../utils/sanitize-user";

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body as {
    username: string;
    password: string;
  };

  const user = await prisma.user.findUnique({
    where: { username },
  });

  if (!user || !user.isActive) {
    throw new AppError("Invalid username or password", 401, "INVALID_CREDENTIALS");
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError("Invalid username or password", 401, "INVALID_CREDENTIALS");
  }

  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  res.json({
    success: true,
    message: "Login successful",
    token,
    user: sanitizeUser(user),
  });
});

export const logout = asyncHandler(async (req, res) => {
  // Logout used to be a bare 200 with no server state, so the token stayed
  // valid for its full lifetime. Bumping the version revokes it (and every
  // other session for this user) immediately.
  if (req.user) {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  res.json({
    success: true,
    message: "Logout successful",
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user || !user.isActive) {
    throw new AppError("User is inactive or no longer exists", 401, "USER_INACTIVE");
  }

  const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError("Current password is incorrect", 400, "INVALID_CURRENT_PASSWORD");
  }

  const passwordHash = await bcrypt.hash(
    newPassword,
    Number(process.env.BCRYPT_SALT_ROUNDS ?? 10)
  );

  // Revoke every session issued under the old password — the whole point of
  // changing it after a suspected compromise.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });

  res.json({
    success: true,
    message: "Password changed successfully",
  });
});
