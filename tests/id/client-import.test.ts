import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { findClientPostLogoutUris, importClients, type ClientStore } from "../../lib/id/client-import.ts";

type Row = Record<string, unknown> & { clientId: string };

/** The oauthClient table in memory, with the calls importClients makes. */
function memoryStore(): ClientStore & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  return {
    rows,
    oauthClient: {
      async findUnique({ where }) {
        const row = rows.get(where.clientId);
        return row ? { id: row.id as string, postLogoutRedirectUris: row.postLogoutRedirectUris as string[] } : null;
      },
      async create({ data }) {
        rows.set(data.clientId, { ...data });
        return data;
      },
      async update({ where, data }) {
        const row = rows.get(where.clientId);
        if (!row) throw new Error("no such row");
        rows.set(where.clientId, { ...row, ...data });
        return row;
      },
    },
  };
}

const secretHash = createHash("sha256").update("typle-secret").digest("hex");
const CLIENTS = JSON.stringify([
  {
    id: "typle-r",
    name: "typle",
    secretHash,
    redirectUris: ["https://typle.example/api/auth/callback/sparklingstadt"],
    postLogoutRedirectUris: ["https://typle.example/"],
  },
]);

test("importClients stores each client of OIDC_CLIENTS as an oauthClient row", async () => {
  const store = memoryStore();
  assert.deepEqual(await importClients(store, CLIENTS), { created: 1, updated: 0 });

  const row = store.rows.get("typle-r");
  assert.ok(row);
  assert.equal(typeof row.id, "string");
  assert.ok((row.id as string).length > 0);
  const { createdAt, updatedAt, ...rest } = row;
  const values = { ...rest };
  delete values.id;
  assert.ok(createdAt instanceof Date);
  assert.ok(updatedAt instanceof Date);
  assert.deepEqual(values, {
    clientId: "typle-r",
    name: "typle",
    // The stored secret is the SHA-256 hex the server compares with, so the client's secret stays the same.
    clientSecret: secretHash,
    redirectUris: ["https://typle.example/api/auth/callback/sparklingstadt"],
    postLogoutRedirectUris: ["https://typle.example/"],
    scopes: ["openid", "email", "profile"],
    skipConsent: true,
    enableEndSession: true,
    tokenEndpointAuthMethod: "client_secret_basic",
    grantTypes: ["authorization_code"],
    responseTypes: ["code"],
    requirePKCE: true,
    disabled: false,
    applicationType: "web",
  });
});

test("importClients run twice leaves the same row and counts it as updated", async () => {
  const store = memoryStore();
  await importClients(store, CLIENTS);
  const first = { ...store.rows.get("typle-r") };
  assert.deepEqual(await importClients(store, CLIENTS), { created: 0, updated: 1 });
  const second = { ...store.rows.get("typle-r") };
  assert.equal(store.rows.size, 1);
  assert.equal(second.id, first.id);
  delete first.updatedAt;
  delete second.updatedAt;
  assert.deepEqual(second, first);
});

test("importClients takes a changed secret and addresses on the next run", async () => {
  const store = memoryStore();
  await importClients(store, CLIENTS);
  const next = createHash("sha256").update("rotated").digest("hex");
  const changed = JSON.stringify([
    { id: "typle-r", name: "typle", secretHash: next, redirectUris: ["https://typle.example/cb"] },
  ]);
  await importClients(store, changed);
  const row = store.rows.get("typle-r");
  assert.equal(row?.clientSecret, next);
  assert.deepEqual(row?.redirectUris, ["https://typle.example/cb"]);
  assert.deepEqual(row?.postLogoutRedirectUris, []);
});

test("importClients rejects a malformed list without writing anything", async () => {
  for (const json of [
    "{}",
    "not json",
    JSON.stringify([{ id: "a", name: "a", secretHash: "short", redirectUris: [] }]),
    JSON.stringify([{ id: "a", name: "a", secretHash, redirectUris: ["javascript:alert(1)"] }]),
    JSON.stringify([
      { id: "a", name: "a", secretHash, redirectUris: [] },
      { id: "a", name: "b", secretHash, redirectUris: [] },
    ]),
  ]) {
    const store = memoryStore();
    await assert.rejects(importClients(store, json));
    assert.equal(store.rows.size, 0);
  }
});

test("importClients never puts the secret hash in its error messages", async () => {
  const json = JSON.stringify([{ id: "", name: "a", secretHash, redirectUris: [] }]);
  await assert.rejects(importClients(memoryStore(), json), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(secretHash));
    return true;
  });
});

test("an empty OIDC_CLIENTS imports nothing", async () => {
  assert.deepEqual(await importClients(memoryStore(), ""), { created: 0, updated: 0 });
});

test("findClientPostLogoutUris returns the registered addresses, or null for an unknown client", async () => {
  const store = memoryStore();
  await importClients(store, CLIENTS);
  assert.deepEqual(await findClientPostLogoutUris("typle-r", store), ["https://typle.example/"]);
  assert.equal(await findClientPostLogoutUris("no-such-client", store), null);
});
