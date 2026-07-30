import { NextFunction, Request, Response } from "express";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../utils/jwt";

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      throw new AppError("Authorization token is required", 401, "TOKEN_REQUIRED");
    }

    const token = authHeader.split(" ")[1];
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || !user.isActive) {
      throw new AppError("User is inactive or no longer exists", 401, "USER_INACTIVE");
    }

    // Tokens issued before the current version are revoked (password changed,
    // or the user logged out). Tokens minted before this field existed carry
    // no version and are treated as 0, matching the column default, so nobody
    // is logged out by the upgrade itself.
    if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
      throw new AppError("Session expired, please sign in again", 401, "TOKEN_REVOKED");
    }

    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      isActive: user.isActive,
    };

    next();
  } catch (error) {
    next(error);
  }
}
