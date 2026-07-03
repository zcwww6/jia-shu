import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "@/server/config/env";

const globalForPrisma = globalThis as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

export function getPrismaClient() {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  globalForPrisma.prisma = createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    return globalForPrisma.prisma;
  }

  return globalForPrisma.prisma;
}
