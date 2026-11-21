import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to connect to Neon Postgres.");
  }

  const connectionString = databaseUrl.replace(
    /([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/,
    "$1sslmode=verify-full",
  );

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

// One client (and one connection pool) per process. Creating a client per call
// opens a new pool each time and exhausts the database's connections.
export function getPrisma() {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}
