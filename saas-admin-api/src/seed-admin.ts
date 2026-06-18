/**
 * Creates the initial super admin account.
 * Run once: npx tsx src/seed-admin.ts
 * Uses ADMIN_PASSWORD from .env (defaults to "admin123" for dev)
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import prisma from "./prisma";

async function main() {
  const username = "superadmin";
  const password = process.env.ADMIN_PASSWORD ?? "admin123";
  const hash = await bcrypt.hash(password, 12);

  const admin = await prisma.adminUser.upsert({
    where: { username },
    update: { passwordHash: hash },
    create: { username, passwordHash: hash },
  });

  console.log(`Super admin created/updated: ${admin.username}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
