import { User } from "@prisma/client";

export function sanitizeUser(user: User) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
