import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { importLegacy, type LegacyStore } from "../lib/id/legacy-import.ts";
import { explicitEnv, printTarget } from "./explicit-env.ts";

// The one-time move from the old implementation: the owner's account (same id, so the `sub` clients store stays),
// OIDC_CLIENTS and OIDC_SIGNING_KEY into Better Auth's tables. Safe to run again. Prints one JSON line.
//
// It never reads .env.local: every value comes from the shell, or all of them from one --env-file (explicit-env.ts).
const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "OIDC_SIGNING_KEY", "OIDC_CLIENTS", "ID_ISSUER"] as const;
const values = explicitEnv(REQUIRED);
printTarget(values.DATABASE_URL, `must be the database Vercel uses; issuer ${values.ID_ISSUER}`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: values.DATABASE_URL }) });
try {
  const result = await importLegacy(prisma as unknown as LegacyStore, {
    OIDC_CLIENTS: values.OIDC_CLIENTS,
    // JSON, so surrounding whitespace carries no meaning.
    OIDC_SIGNING_KEY: values.OIDC_SIGNING_KEY.trim(),
    BETTER_AUTH_SECRET: values.BETTER_AUTH_SECRET,
  });
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
