import { randomUUID } from "node:crypto";
import { symmetricEncrypt } from "better-auth/crypto";
import { importClients, type ClientStore } from "./client-import.ts";

/** The part of the Prisma client this module uses. */
export type LegacyStore = ClientStore & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(fn: (tx: LegacyStore) => Promise<T>): Promise<T>;
  user: {
    findFirst(args: { where: { OR: Array<{ id: string } | { email: string }> }; select: { id: true } }): Promise<{ id: string } | null>;
    create(args: {
      data: { id: string; email: string; name: string; emailVerified: boolean; createdAt: Date; updatedAt: Date };
    }): Promise<unknown>;
  };
  account: {
    create(args: {
      data: { id: string; accountId: string; providerId: string; userId: string; password: string };
    }): Promise<unknown>;
  };
  jwks: {
    findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
    create(args: {
      data: { id: string; publicKey: string; privateKey: string; createdAt: Date; alg: string; crv: string };
    }): Promise<unknown>;
  };
};

export type LegacyEnv = {
  OIDC_CLIENTS?: string;
  OIDC_SIGNING_KEY?: string;
  /** Encrypts the imported private key, as the jwt plugin does for the keys it makes. */
  BETTER_AUTH_SECRET?: string;
};

type LegacyRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/**
 * Copies the owner's row of the old `users` table into Better Auth's tables: the same id (the `sub` every client
 * stores), email, name = display_name, emailVerified = email_verified_at is set, and the password hash as it is. A row
 * whose id is already there is skipped, so running it again changes nothing. A row whose email belongs to a different
 * id (an account made on the new sign-up meanwhile) is a conflict: it throws, naming the ids, because skipping it
 * would leave the owner with a new `sub`. The old table is read with
 * SQL and may be gone (the drop migration removes it), which counts as no users.
 */
async function importUsers(prisma: LegacyStore): Promise<number> {
  const [{ present }] = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
    "select to_regclass('public.users') is not null as present",
  );
  if (!present) return 0;
  const rows = await prisma.$queryRawUnsafe<LegacyRow[]>(
    `select id, email, display_name, password_hash, email_verified_at, created_at, updated_at from "users" order by created_at`,
  );
  let imported = 0;
  for (const row of rows) {
    const done = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({ where: { OR: [{ id: row.id }, { email: row.email }] }, select: { id: true } });
      if (existing && existing.id === row.id) return false;
      if (existing) {
        throw new Error(
          `legacy user ${row.id} has the same email as ba_users row ${existing.id}: delete that ba_users row, then import again`,
        );
      }
      await tx.user.create({
        data: {
          id: row.id,
          email: row.email,
          name: row.display_name,
          emailVerified: row.email_verified_at !== null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
      await tx.account.create({
        data: { id: randomUUID(), accountId: row.id, providerId: "credential", userId: row.id, password: row.password_hash },
      });
      return true;
    });
    if (done) imported += 1;
  }
  return imported;
}

/**
 * Puts the old OIDC_SIGNING_KEY (an ES256 private JWK with a kid) into the jwt plugin's key table under the same kid,
 * as the newest key, so that tokens keep the kid clients already have. "skipped" when there is no usable key, no
 * BETTER_AUTH_SECRET to encrypt it with, or the kid is already there; the plugin then makes its own key (clients read
 * the JWKS again and follow).
 */
async function importSigningKey(prisma: LegacyStore, env: LegacyEnv): Promise<"imported" | "skipped"> {
  const secret = env.BETTER_AUTH_SECRET;
  if (!env.OIDC_SIGNING_KEY?.trim() || !secret) return "skipped";
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(env.OIDC_SIGNING_KEY);
  } catch {
    return "skipped";
  }
  const { kty, crv, x, y, d, kid } = jwk;
  if (kty !== "EC" || crv !== "P-256" || typeof x !== "string" || typeof y !== "string" || typeof d !== "string") {
    return "skipped";
  }
  if (typeof kid !== "string" || !kid) return "skipped";
  if (await prisma.jwks.findUnique({ where: { id: kid }, select: { id: true } })) return "skipped";
  await prisma.jwks.create({
    data: {
      id: kid,
      publicKey: JSON.stringify({ kty, crv, x, y }),
      privateKey: JSON.stringify(await symmetricEncrypt({ key: secret, data: JSON.stringify({ kty, crv, x, y, d }) })),
      createdAt: new Date(),
      alg: "ES256",
      crv: "P-256",
    },
  });
  return "imported";
}

/**
 * The one-time move from the old implementation (spec 4.6): the owner's account, OIDC_CLIENTS and the signing key.
 * Safe to run again.
 */
export async function importLegacy(
  prisma: LegacyStore,
  env: LegacyEnv,
): Promise<{ users: number; clients: number; key: "imported" | "skipped" }> {
  const users = await importUsers(prisma);
  const { created, updated } = await importClients(prisma, env.OIDC_CLIENTS ?? "[]");
  const key = await importSigningKey(prisma, env);
  return { users, clients: created + updated, key };
}
