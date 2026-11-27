import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { importLegacy, type LegacyStore } from "../lib/id/legacy-import.ts";

// The one-time move from the old implementation: the owner's account (same id, so the `sub` clients store stays),
// OIDC_CLIENTS and OIDC_SIGNING_KEY into Better Auth's tables. Safe to run again. Prints one JSON line.
//
// It never reads .env.local: a development value must not reach production. Every value comes from the shell, or
// all of them from one file named on the command line (`--env-file=production.env`). Each source is printed
// (never the value), so the person running it can check them before the import changes anything.
const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "OIDC_SIGNING_KEY", "OIDC_CLIENTS", "ID_ISSUER"] as const;

const fileArg = process.argv.slice(2).find((arg) => arg.startsWith("--env-file="));
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== fileArg);
if (unknownArgs.length > 0) {
  console.error(`Unknown argument: ${unknownArgs[0]}. The only option is --env-file=<path>.`);
  process.exit(1);
}
const file = fileArg ? parseEnv(readFileSync(fileArg.slice("--env-file=".length), "utf8")) : undefined;
const source = file ? `file ${fileArg!.slice("--env-file=".length)}` : "shell";
// Values are used as they are: the server takes BETTER_AUTH_SECRET byte for byte, so the key must be encrypted with
// that exact string (surrounding whitespace included). Trimming is only for the check that a value is set.
const values = Object.fromEntries(REQUIRED.map((name) => [name, (file ? file[name] : process.env[name]) ?? ""]));
const missing = REQUIRED.filter((name) => !values[name].trim());
if (missing.length > 0) {
  console.error(
    `Set ${missing.join(", ")} explicitly in the shell, or in a file given as --env-file=<path>. ` +
      ".env.local is not read: this import writes to the database it is pointed at.",
  );
  process.exit(1);
}

for (const name of REQUIRED) console.error(`${name}: from ${source}`);
const target = new URL(values.DATABASE_URL);
console.error(`database: ${target.host}${target.pathname} (must be the database Vercel uses; issuer ${values.ID_ISSUER})`);

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
