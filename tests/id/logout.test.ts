import assert from "node:assert/strict";
import { test } from "node:test";
import type { OidcClient } from "../../lib/id/clients.ts";
import type { OidcConfig } from "../../lib/id/config.ts";
import { generateSigningJwk, loadSigningKey, signJwt } from "../../lib/id/jwt.ts";
import { resolvePostLogoutRedirect } from "../../lib/id/logout.ts";

const ISSUER = "https://id.example";
const A_URI = "https://a.example/signout";
const B_URI = "https://b.example/signout";

function client(id: string, uri: string): OidcClient {
  return { id, name: id, secretHash: "0".repeat(64), redirectUris: [], postLogoutRedirectUris: [uri] };
}

const signingKey = loadSigningKey(generateSigningJwk());
const config: OidcConfig = {
  issuer: ISSUER,
  signingKey,
  publicKeys: [signingKey.publicJwk],
  clients: [client("a", A_URI), client("b", B_URI)],
};

function idToken(claims: Record<string, unknown>, key = signingKey): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(key, { iss: ISSUER, sub: "u1", aud: "a", iat: now - 7200, exp: now - 3600, ...claims });
}

test("returns the registered URI with state", () => {
  const params = new URLSearchParams({ client_id: "a", post_logout_redirect_uri: A_URI, state: "x" });
  assert.equal(resolvePostLogoutRedirect(config, params), `${A_URI}?state=x`);
});

test("returns the registered URI without state when none is given", () => {
  const params = new URLSearchParams({ client_id: "a", post_logout_redirect_uri: A_URI });
  assert.equal(resolvePostLogoutRedirect(config, params), A_URI);
});

test("rejects another client's post-logout URI", () => {
  const params = new URLSearchParams({ client_id: "a", post_logout_redirect_uri: B_URI });
  assert.equal(resolvePostLogoutRedirect(config, params), null);
});

test("accepts an expired id_token_hint signed by this server when client_id is absent", () => {
  const params = new URLSearchParams({ id_token_hint: idToken({}), post_logout_redirect_uri: A_URI, state: "x" });
  assert.equal(resolvePostLogoutRedirect(config, params), `${A_URI}?state=x`);
});

test("accepts an aud array containing client_id", () => {
  const params = new URLSearchParams({
    client_id: "a",
    id_token_hint: idToken({ aud: ["x", "a"] }),
    post_logout_redirect_uri: A_URI,
  });
  assert.equal(resolvePostLogoutRedirect(config, params), A_URI);
});

test("rejects an id_token_hint with a foreign signature", () => {
  const other = loadSigningKey(generateSigningJwk());
  const params = new URLSearchParams({ id_token_hint: idToken({}, other), post_logout_redirect_uri: A_URI });
  assert.equal(resolvePostLogoutRedirect(config, params), null);
});

test("rejects an id_token_hint with another issuer", () => {
  const params = new URLSearchParams({
    id_token_hint: idToken({ iss: "https://evil.example" }),
    post_logout_redirect_uri: A_URI,
  });
  assert.equal(resolvePostLogoutRedirect(config, params), null);
});

test("rejects client_id that disagrees with the id_token_hint audience", () => {
  const params = new URLSearchParams({
    client_id: "a",
    id_token_hint: idToken({ aud: "b" }),
    post_logout_redirect_uri: A_URI,
  });
  assert.equal(resolvePostLogoutRedirect(config, params), null);
});

test("returns null without post_logout_redirect_uri", () => {
  assert.equal(resolvePostLogoutRedirect(config, new URLSearchParams({ client_id: "a" })), null);
});

test("returns null without client_id or a valid id_token_hint", () => {
  assert.equal(resolvePostLogoutRedirect(config, new URLSearchParams({ post_logout_redirect_uri: A_URI })), null);
});
