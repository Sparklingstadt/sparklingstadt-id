import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { importClients } from "../lib/id/client-import.ts";
import { explicitEnv, printTarget } from "./explicit-env.ts";

// Copies OIDC_CLIENTS into Better Auth's oauthClient table. Safe to run again: known clients are overwritten with
// the listed values, and the secrets stay the same (the stored value is the same SHA-256 hex). Prints one line.
//
// It never reads .env.local: every value comes from the shell, or all of them from one --env-file (explicit-env.ts).
const values = explicitEnv(["DATABASE_URL", "OIDC_CLIENTS"] as const);
printTarget(values.DATABASE_URL, "must be the database Vercel uses");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: values.DATABASE_URL }) });
try {
  const { created, updated } = await importClients(prisma, values.OIDC_CLIENTS);
  console.log(`oauthClient: ${created} created, ${updated} updated`);
} finally {
  await prisma.$disconnect();
}
