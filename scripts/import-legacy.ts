import nextEnv from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { importLegacy, type LegacyStore } from "../lib/id/legacy-import.ts";

// The one-time move from the old implementation: the owner's account (same id, so the `sub` clients store stays),
// OIDC_CLIENTS and OIDC_SIGNING_KEY into Better Auth's tables. Safe to run again. Prints one JSON line.
nextEnv.loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL must be set (.env.local or the environment).");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const result = await importLegacy(prisma as unknown as LegacyStore, {
    OIDC_CLIENTS: process.env.OIDC_CLIENTS,
    OIDC_SIGNING_KEY: process.env.OIDC_SIGNING_KEY,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  });
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
