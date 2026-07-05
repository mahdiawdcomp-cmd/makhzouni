/**
 * create-first-admin — safe first-admin bootstrap for a NEW tenant backend.
 *
 * Run AFTER `prisma migrate deploy` on a fresh tenant database:
 *   npm run create:first-admin -- --username <user> --name "اسم المدير"
 *   (password via env FIRST_ADMIN_PASSWORD, or --password — env preferred so
 *    the password does not land in shell history)
 *
 * Guarantees:
 *   - NEVER deletes or modifies existing data (create-only).
 *   - Refuses to run if ANY user already exists, unless --allow-existing
 *     is passed explicitly (then it still refuses if the username is taken).
 *   - No hardcoded credentials, no demo data.
 *   - Same hashing as the app (bcrypt, BCRYPT_SALT_ROUNDS ?? 10).
 *   - Never prints the password.
 *
 * This complements ensureInitialAdmin() (src/services/initial-admin.service.ts),
 * which does the same thing at server startup from INITIAL_ADMIN_* env vars.
 * Use this script when you want to create the admin from a terminal instead.
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function checkPasswordStrength(password: string): string | null {
  if (password.length < 10) return "password must be at least 10 characters";
  if (!/[a-zA-Z]/.test(password)) return "password must contain a letter";
  if (!/[0-9]/.test(password)) return "password must contain a digit";
  const banned = ["password123", "admin123456", "1234567890", "qwerty12345"];
  if (banned.includes(password.toLowerCase())) return "password is too common";
  return null;
}

async function main() {
  const username = (getArg("--username") ?? process.env.FIRST_ADMIN_USERNAME ?? "").trim();
  const password = getArg("--password") ?? process.env.FIRST_ADMIN_PASSWORD ?? "";
  const name = (getArg("--name") ?? process.env.FIRST_ADMIN_NAME ?? "").trim() || "مدير النظام";
  const phone = (getArg("--phone") ?? process.env.FIRST_ADMIN_PHONE ?? "").trim() || null;
  const allowExisting = process.argv.includes("--allow-existing");

  if (!username || username.length < 3) fail("--username (or FIRST_ADMIN_USERNAME) is required, min 3 chars");
  if (!password) fail("password is required — set FIRST_ADMIN_PASSWORD env (preferred) or pass --password");
  const weakness = checkPasswordStrength(password);
  if (weakness) fail(weakness);

  const userCount = await prisma.user.count();
  if (userCount > 0 && !allowExisting) {
    fail(
      `refusing to run: ${userCount} user(s) already exist in this database. ` +
      "This script is for FRESH tenant databases only. " +
      "Pass --allow-existing ONLY if you are sure this is the right database.",
    );
  }
  const taken = await prisma.user.findUnique({ where: { username } });
  if (taken) fail(`username "${username}" already exists — nothing was changed.`);

  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS ?? 10));

  const admin = await prisma.user.create({
    data: {
      name,
      username,
      passwordHash,
      role: UserRole.ADMIN,
      phone,
      isActive: true,
    },
  });

  console.log(`OK: admin user created — id=${admin.id} username=${admin.username} role=${admin.role}`);
  console.log("The password was NOT printed. Store it in your password manager.");
}

main()
  .catch((error) => {
    console.error("ERROR:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
