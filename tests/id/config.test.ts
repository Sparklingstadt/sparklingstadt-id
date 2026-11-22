import assert from "node:assert/strict";
import test from "node:test";
import { loadOidcConfig, OidcConfigError } from "../../lib/id/config.ts";
import { generateSigningJwk } from "../../lib/id/jwt.ts";
import { hashToken } from "../../lib/id/tokens.ts";

const signingKey = generateSigningJwk();
const client = {
  id: "typle-r",
  name: "Typle",
  secretHash: hashToken("s3cret-value"),
  redirectUris: ["https://typle.example/api/auth/callback/sid"],
};
const env = {
  ID_ISSUER: "https://id.example/",
  OIDC_SIGNING_KEY: signingKey,
  OIDC_CLIENTS: JSON.stringify([client]),
};

/** Asserts the load fails with `expected` in a message that does not contain `secret`. */
function assertRejected(overrides: Record<string, string | undefined>, expected: RegExp, secret?: string) {
  assert.throws(
    () => loadOidcConfig({ ...env, ...overrides }),
    (error: unknown) => {
      assert.ok(error instanceof OidcConfigError);
      assert.match(error.message, expected);
      if (secret) assert.ok(!error.message.includes(secret), `the message leaks the value: ${error.message}`);
      return true;
    },
  );
}

test("loadOidcConfig reads a valid configuration", () => {
  const config = loadOidcConfig(env);
  assert.equal(config.issuer, "https://id.example");
  assert.equal(config.clients[0].id, "typle-r");
  assert.equal(config.publicKeys.length, 1);
  assert.equal(config.publicKeys[0].kid, config.signingKey.kid);
});

test("loadOidcConfig names a missing variable", () => {
  assertRejected({ ID_ISSUER: undefined }, /^ID_ISSUER: is not set$/);
  assertRejected({ OIDC_SIGNING_KEY: "  " }, /^OIDC_SIGNING_KEY: is not set$/);
});

test("a broken signing key is named without any part of it", () => {
  const { d, ...rest } = JSON.parse(signingKey) as { d: string };
  // A paste that starts before the key: JSON.parse's own message quotes the start of its input.
  const pasted = `x${JSON.stringify({ d, ...rest })}`;
  assert.throws(() => JSON.parse(pasted), (error: Error) => error.message.includes(d.slice(0, 2)));
  // The whole message is fixed, so no part of d can be in it.
  assertRejected({ OIDC_SIGNING_KEY: pasted }, /^OIDC_SIGNING_KEY: is not valid JSON$/);
  assertRejected({ OIDC_SIGNING_KEY: signingKey.slice(0, -5) }, /^OIDC_SIGNING_KEY: is not valid JSON$/);
  // The display masked the private part.
  const masked = JSON.stringify({ ...JSON.parse(signingKey), d: "•••••" });
  assertRejected({ OIDC_SIGNING_KEY: masked }, /^OIDC_SIGNING_KEY: /);
  assertRejected({ OIDC_SIGNING_KEY: JSON.stringify({ kty: "RSA" }) }, /^OIDC_SIGNING_KEY: Signing key must be an EC P-256 JWK$/);
});

test("a client list that is not an array, or not JSON, is named", () => {
  // The mistake that took down the server: the object without [ ].
  assertRejected({ OIDC_CLIENTS: JSON.stringify(client) }, /^OIDC_CLIENTS: OIDC_CLIENTS must be a JSON array$/);
  assertRejected({ OIDC_CLIENTS: '[{"id":"typle-r","secretHash":"<出力の値>"' }, /^OIDC_CLIENTS: is not valid JSON$/, "出力の値");
  assertRejected(
    { OIDC_CLIENTS: JSON.stringify([{ ...client, secretHash: "<出力の値>" }]) },
    /^OIDC_CLIENTS: OIDC_CLIENTS\[0\]\.secretHash must be 64 lowercase hex characters$/,
  );
});

test("previous public keys that are not JSON are named", () => {
  assertRejected({ OIDC_PREVIOUS_PUBLIC_KEYS: "[{" }, /^OIDC_PREVIOUS_PUBLIC_KEYS: is not valid JSON$/);
});
