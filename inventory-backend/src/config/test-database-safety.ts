export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined): void {
  const value = databaseUrl?.trim();
  if (!value) return;

  let databaseName = "";
  try {
    databaseName = decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("[TEST GUARD] DATABASE_URL is not a valid URL; refusing to create PrismaClient.");
  }

  if (!databaseName.toLowerCase().endsWith("_test")) {
    throw new Error(
      `[TEST GUARD] Refusing to create PrismaClient for database "${databaseName || "unknown"}". ` +
      "Tests may only use an isolated database whose name ends with _test.",
    );
  }
}

