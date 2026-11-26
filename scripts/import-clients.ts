import nextEnv from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { importClients } from "../lib/id/client-import.ts";

// Copies OIDC_CLIENTS into Better Auth's oauthClient table. Safe to run again: known clients are overwritten with
// the listed values, and the secrets stay the same (the stored value is the same SHA-256 hex).
nextEnv.loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
const clients = process.env.OIDC_CLIENTS;
if (!databaseUrl || !clients) {
  console.error("DATABASE_URL and OIDC_CLIENTS must be set (.env.local or the environment).");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const { created, updated } = await importClients(prisma, clients);
  console.log(`oauthClient: ${created} created, ${updated} updated`);
} finally {
  await prisma.$disconnect();
}
