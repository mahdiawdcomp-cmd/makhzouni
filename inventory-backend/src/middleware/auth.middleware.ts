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

    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      isActive: user.isActive,
    };

    next();
  } catch (error) {
    next(error);
  }
}
