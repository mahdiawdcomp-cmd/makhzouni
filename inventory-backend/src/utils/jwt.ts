import jwt, { SignOptions } from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { AppError } from "./app-error";

export interface JwtPayload {
  userId: string;
  username: string;
  role: UserRole;
  /**
   * The user's tokenVersion at sign time. authMiddleware rejects the token when
   * the stored version has moved on, so a password change or an explicit logout
   * genuinely revokes existing sessions instead of leaving a stolen 30-day
   * token valid. Optional so tokens issued before this field existed keep
   * working until they expire naturally (treated as version 0).
   */
  tokenVersion?: number;
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
    // Shorter than the previous 30 days: a leaked token is now bounded by a
    // week rather than a month, and tokenVersion covers deliberate revocation.
    expiresIn: "7d",
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
