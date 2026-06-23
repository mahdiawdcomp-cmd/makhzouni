import jwt, { SignOptions } from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { AppError } from "./app-error";

export interface JwtPayload {
  userId: string;
  username: string;
  role: UserRole;
}

const jwtSecret = process.env.JWT_SECRET;

function getJwtSecret() {
  if (!jwtSecret) {
    throw new AppError("JWT secret is not configured", 500, "JWT_SECRET_MISSING");
  }

  return jwtSecret;
}

export function signToken(payload: JwtPayload) {
  const options: SignOptions = {
    expiresIn: "30d",
  };

  return jwt.sign(payload, getJwtSecret(), options);
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
  } catch {
    throw new AppError("Invalid or expired token", 401, "INVALID_TOKEN");
  }
}
