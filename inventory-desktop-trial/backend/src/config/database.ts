import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Auto-reconnect after Neon auto-suspend
async function ensureConnected(retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// Wrap queryRaw to reconnect on Neon termination errors
const originalConnect = prisma.$connect.bind(prisma);
prisma.$connect = async () => {
  await originalConnect();
  await ensureConnected();
};

export { ensureConnected };
export default prisma;
