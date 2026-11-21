import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticateClient,
  findClient,
  isRegisteredRedirect,
  parseBasicCredentials,
  parseClients,
} from "../../lib/id/clients.ts";
import { hashToken } from "../../lib/id/tokens.ts";

const secret = "s3cret-value";
const client = {
  id: "typle-r",
  name: "typle-r",
  secretHash: hashToken(secret),
  redirectUris: ["https://typle.example/api/auth/callback/sid"],
};
const json = JSON.stringify([client]);

test("parseClients reads a valid list and treats unset as empty", () => {
  assert.deepEqual(parseClients(json), [{ ...client, postLogoutRedirectUris: [] }]);
  assert.deepEqual(parseClients(undefined), []);
  assert.deepEqual(parseClients(""), []);
  assert.deepEqual(parseClients("  "), []);
});

test("parseClients rejects invalid input", () => {
  assert.throws(() => parseClients("{not json"));
  assert.throws(() => parseClients(JSON.stringify({ id: "a" })));
  assert.throws(() => parseClients(JSON.stringify([null])));
  for (const key of ["id", "name", "secretHash", "redirectUris"] as const) {
    const broken: Record<string, unknown> = { ...client };
    delete broken[key];
    assert.throws(() => parseClients(JSON.stringify([broken])), key);
  }
  assert.throws(() => parseClients(JSON.stringify([{ ...client, id: "" }])));
  assert.throws(() => parseClients(JSON.stringify([{ ...client, redirectUris: ["ftp://x.example/cb"] }])));
  assert.throws(() => parseClients(JSON.stringify([{ ...client, redirectUris: ["not a url"] }])));
  assert.throws(() => parseClients(JSON.stringify([{ ...client, redirectUris: [1] }])));
  assert.throws(() => parseClients(JSON.stringify([client, { ...client, name: "dup" }])));
  assert.throws(() => parseClients(JSON.stringify([{ ...client, secretHash: "abc" }])));
  assert.throws(() => parseClients(JSON.stringify([{ ...client, secretHash: client.secretHash.toUpperCase() }])));
});

test("parseClients accepts an empty redirectUris list", () => {
  assert.equal(parseClients(JSON.stringify([{ ...client, redirectUris: [] }]))[0].redirectUris.length, 0);
});

test("findClient", () => {
  const clients = parseClients(json);
  assert.equal(findClient(clients, "typle-r")?.id, "typle-r");
  assert.equal(findClient(clients, "nope"), undefined);
  assert.equal(findClient(clients, null), undefined);
});

test("authenticateClient", () => {
  const clients = parseClients(json);
  assert.equal(authenticateClient(clients, "typle-r", secret)?.id, "typle-r");
  assert.equal(authenticateClient(clients, "typle-r", "wrong"), undefined);
  assert.equal(authenticateClient(clients, "unknown", secret), undefined);
  assert.equal(authenticateClient(clients, null, secret), undefined);
  assert.equal(authenticateClient(clients, "typle-r", null), undefined);
  assert.equal(authenticateClient(clients, "typle-r", ""), undefined);
  assert.equal(authenticateClient(clients, "", secret), undefined);
});

test("isRegisteredRedirect is an exact match", () => {
  const c = parseClients(json)[0];
  assert.ok(isRegisteredRedirect(c, "https://typle.example/api/auth/callback/sid"));
  assert.ok(!isRegisteredRedirect(c, "https://typle.example/api/auth/callback/sid/"));
  assert.ok(!isRegisteredRedirect(c, "https://typle.example/api/auth/callback"));
  assert.ok(!isRegisteredRedirect(c, null));
  assert.ok(!isRegisteredRedirect(c, ""));
});

test("parseBasicCredentials form-decodes the id and secret after base64 (RFC 6749 §2.3.1)", () => {
  const header = (raw: string) => `Basic ${Buffer.from(raw).toString("base64")}`;
  assert.deepEqual(parseBasicCredentials(header("typle-r:s3cret-value")), {
    id: "typle-r",
    secret: "s3cret-value",
  });
  // Encoded ":", "+", "%" and spaces; only the first raw ":" separates.
  assert.deepEqual(parseBasicCredentials(header("my%3Aclient:a+b%2Bc%25d%3Ae")), {
    id: "my:client",
    secret: "a b+c%d:e",
  });
  assert.deepEqual(parseBasicCredentials(`basic ${Buffer.from("a:b").toString("base64")}`), {
    id: "a",
    secret: "b",
  });
});

test("parseBasicCredentials rejects malformed headers", () => {
  const header = (raw: string) => `Basic ${Buffer.from(raw).toString("base64")}`;
  assert.equal(parseBasicCredentials("Bearer abc"), null);
  assert.equal(parseBasicCredentials("Basic"), null);
  assert.equal(parseBasicCredentials("Basic !!!not-base64!!!"), null);
  assert.equal(parseBasicCredentials(header("no-colon")), null);
  assert.equal(parseBasicCredentials(header(":secret")), null);
  assert.equal(parseBasicCredentials(header("id:")), null);
  assert.equal(parseBasicCredentials(header("id:%E0%A4%A")), null);
});

test("postLogoutRedirectUris defaults to []", () => {
  const [c] = parseClients(
    JSON.stringify([
      {
        id: "a",
        name: "A",
        secretHash: "0".repeat(64),
        redirectUris: ["https://a.example/cb"],
      },
    ]),
  );
  assert.deepEqual(c.postLogoutRedirectUris, []);
});

test("postLogoutRedirectUris must be http(s) URLs", () => {
  assert.throws(
    () =>
      parseClients(
        JSON.stringify([
          {
            id: "a",
            name: "A",
            secretHash: "0".repeat(64),
            redirectUris: ["https://a.example/cb"],
            postLogoutRedirectUris: ["javascript:alert(1)"],
          },
        ]),
      ),
    /OIDC_CLIENTS\[0\]\.postLogoutRedirectUris/,
  );
});
