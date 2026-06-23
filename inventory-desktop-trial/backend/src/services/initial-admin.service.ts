import bcrypt from "bcrypt";
import { UserRole } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";

export async function ensureInitialAdmin(): Promise<void> {
  const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  const name = process.env.INITIAL_ADMIN_NAME?.trim() || "مدير النظام";

  if (!username || !password) return;

  const userCount = await prisma.user.count();
  if (userCount > 0) return;

  if (username.length < 3 || password.length < 8) {
    logger.error("Initial admin was not created: username or password is too short.");
    return;
  }

  const passwordHash = await bcrypt.hash(
    password,
    Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
  );

  await prisma.user.create({
    data: {
      name,
      username,
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  logger.info(`Initial administrator "${username}" was created.`);
}
