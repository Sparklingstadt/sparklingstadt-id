import assert from "node:assert/strict";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { logoutHintSubject, resolvePostLogoutRedirect, type LogoutDeps } from "../../lib/id/logout.ts";

const ISSUER = "https://id.example";
const A_URI = "https://a.example/signout";
const B_URI = "https://b.example/signout";
const REGISTERED: Record<string, string[]> = { a: [A_URI], b: [B_URI] };

const { publicKey, privateKey } = await generateKeyPair("ES256");
const other = await generateKeyPair("ES256");
const publicJwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };

const deps: LogoutDeps = {
  issuer: ISSUER,
  jwks: async () => ({ keys: [publicJwk] }),
  postLogoutUris: async (id) => REGISTERED[id] ?? null,
};

async function idToken(claims: Record<string, unknown> = {}, key = privateKey, alg = "ES256") {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "u1", aud: "a", iss: ISSUER, iat: now - 7200, exp: now - 3600, ...claims })
    .setProtectedHeader({ alg, kid: "k1" })
    .sign(key);
}

test("returns the registered URI with state", async () => {
  const params = new URLSearchParams({ client_id: "a", post_logout_redirect_uri: A_URI, state: "x" });
  assert.equal(await resolvePostLogoutRedirect(params, deps), `${A_URI}?state=x`);
});

test("returns the registered URI without state when none is given", async () => {
  const params = new URLSearchParams({ client_id: "a", post_logout_redirect_uri: A_URI });
  assert.equal(await resolvePostLogoutRedirect(params, deps), A_URI);
});

test("rejects another client's post-logout URI, and an unknown client", async () => {
  assert.equal(await resolvePostLogoutRedirect(new URLSearchParams({ client_id: "a", post_logout_redirect_uri: B_URI }), deps), null);
  assert.equal(await resolvePostLogoutRedirect(new URLSearchParams({ client_id: "zz", post_logout_redirect_uri: A_URI }), deps), null);
});

test("needs a client_id or an id_token_hint to name the client", async () => {
  assert.equal(await resolvePostLogoutRedirect(new URLSearchParams({ post_logout_redirect_uri: A_URI }), deps), null);
});

test("accepts an expired id_token_hint signed by this server when client_id is absent", async () => {
  const params = new URLSearchParams({ id_token_hint: await idToken(), post_logout_redirect_uri: A_URI, state: "x" });
  assert.equal(await resolvePostLogoutRedirect(params, deps), `${A_URI}?state=x`);
});

test("accepts an aud array containing client_id", async () => {
  const params = new URLSearchParams({
    id_token_hint: await idToken({ aud: ["a", "b"] }),
    client_id: "b",
    post_logout_redirect_uri: B_URI,
  });
  assert.equal(await resolvePostLogoutRedirect(params, deps), B_URI);
});

test("rejects a client_id that the id_token_hint is not for", async () => {
  const params = new URLSearchParams({ id_token_hint: await idToken(), client_id: "b", post_logout_redirect_uri: B_URI });
  assert.equal(await resolvePostLogoutRedirect(params, deps), null);
});

test("rejects a hint signed by another key, another issuer or another algorithm", async () => {
  for (const hint of [
    await idToken({}, other.privateKey),
    await idToken({ iss: "https://evil.example" }),
    await idToken({}, (await generateKeyPair("ES384")).privateKey, "ES384"),
    "not.a.jwt",
  ]) {
    const params = new URLSearchParams({ id_token_hint: hint, post_logout_redirect_uri: A_URI });
    assert.equal(await resolvePostLogoutRedirect(params, deps), null);
    assert.equal(await logoutHintSubject(params, deps), null);
  }
});

test("logoutHintSubject names the user of an ID token of a registered client", async () => {
  const params = new URLSearchParams({ id_token_hint: await idToken() });
  assert.equal(await logoutHintSubject(params, deps), "u1");
  assert.equal(await logoutHintSubject(new URLSearchParams(), deps), null);
  // An access token of this server is signed with the same key but is for no registered client.
  assert.equal(await logoutHintSubject(new URLSearchParams({ id_token_hint: await idToken({ aud: "https://api.example" }) }), deps), null);
});
