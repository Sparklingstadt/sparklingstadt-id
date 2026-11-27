import assert from "node:assert/strict";
import test from "node:test";
import { importLegacy, type LegacyStore } from "../../lib/id/legacy-import.ts";

type Row = { id: string; email: string };

/** A memory stand-in: `legacy` is what the old users table returns, `users` the existing ba_users rows. */
function store(legacy: Array<Record<string, unknown>>, users: Row[]) {
  const accounts: unknown[] = [];
  const fake = {
    async $queryRawUnsafe(query: string) {
      return query.includes("to_regclass") ? [{ present: true }] : legacy;
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(fake);
    },
    user: {
      async findFirst({ where }: { where: { OR: Array<{ id?: string; email?: string }> } }) {
        return users.find((u) => where.OR.some((c) => c.id === u.id || c.email === u.email)) ?? null;
      },
      async create({ data }: { data: Row }) {
        users.push({ id: data.id, email: data.email });
      },
    },
    account: {
      async create({ data }: { data: unknown }) {
        accounts.push(data);
      },
    },
    jwks: { async findUnique() { return null; }, async create() {} },
    oauthClient: {},
  };
  return { prisma: fake as unknown as LegacyStore, users, accounts };
}

const owner = {
  id: "owner1",
  email: "owner@example.com",
  display_name: "Owner",
  password_hash: "scrypt$x",
  email_verified_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
};

test("a legacy user is imported once and skipped when its id is already there", async () => {
  const s = store([owner], []);
  assert.equal((await importLegacy(s.prisma, { OIDC_CLIENTS: "[]" })).users, 1);
  assert.equal(s.accounts.length, 1);
  assert.equal((await importLegacy(s.prisma, { OIDC_CLIENTS: "[]" })).users, 0);
  assert.equal(s.accounts.length, 1);
});

test("an email that belongs to a different id throws and names both ids, not the email", async () => {
  const s = store([owner], [{ id: "new-signup", email: "owner@example.com" }]);
  await assert.rejects(importLegacy(s.prisma, { OIDC_CLIENTS: "[]" }), (error: Error) => {
    assert.match(error.message, /owner1/);
    assert.match(error.message, /new-signup/);
    assert.doesNotMatch(error.message, /owner@example\.com/);
    return true;
  });
  assert.equal(s.users.length, 1);
  assert.equal(s.accounts.length, 0);
});
