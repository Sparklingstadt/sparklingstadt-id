import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { lastMailTo, readMails } from "./helpers/mail-log";
import { confirmEmailLink } from "./helpers/verify";

const ISSUER = "http://localhost:3000";

// Each test gets its own client IP (page and request fixtures alike) so per-IP throttles never trip.
test.use({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": `e2e-${randomUUID()}` });
  },
});

test("serves the discovery document", async ({ request }) => {
  const response = await request.get("/.well-known/openid-configuration");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
    jwks_uri: `${ISSUER}/oauth/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
    scopes_supported: ["openid", "email", "profile"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
    code_challenge_methods_supported: ["S256"],
    prompt_values_supported: ["none", "login"],
    claims_supported: [
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "auth_time",
      "nonce",
      "email",
      "email_verified",
      "name",
    ],
  });
});

test("serves the public signing key without private material", async ({
  request,
}) => {
  const response = await request.get("/oauth/jwks");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=600");
  const { keys } = await response.json();
  expect(keys.length).toBeGreaterThanOrEqual(1);
  expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256" });
  expect(typeof keys[0].kid).toBe("string");
  expect(keys[0].kid.length).toBeGreaterThan(0);
  for (const key of keys) expect(key).not.toHaveProperty("d");
  const kids = keys.map((key: { kid: string }) => key.kid);
  expect(new Set(kids).size).toBe(kids.length);
});

const CLIENT_ID = "e2e-client";
const REDIRECT_URI = `${ISSUER}/e2e-callback`;
const PASSWORD = "  twelve chars  ";

function authorizeParams(overrides: Record<string, string | null> = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const values: Record<string, string | null> = {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state: `state-${randomUUID()}`,
    nonce: `nonce-${randomUUID()}`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) params.set(key, value);
  }
  return params;
}

function authorizePath(overrides: Record<string, string | null> = {}) {
  return `/oauth/authorize?${authorizeParams(overrides)}`;
}

function newEmail() {
  return `oidc-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
}

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("表示名").fill("おーあいでぃーしー");
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("確認メールを送りました")).toBeVisible();
}

async function submitLogin(page: Page, email: string) {
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

for (const [name, overrides] of [
  ["an unknown client_id", { client_id: "no-such-client" }],
  ["a missing client_id", { client_id: null }],
  ["an unregistered redirect_uri", { redirect_uri: `${ISSUER}/e2e-callback/other` }],
  ["a missing redirect_uri", { redirect_uri: null }],
] as const) {
  test(`authorize shows an error page without redirecting for ${name}`, async ({ request }) => {
    const response = await request.get(authorizePath(overrides), { maxRedirects: 0 });
    expect(response.status()).toBe(400);
    expect(response.headers()["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers()["location"]).toBeUndefined();
    const body = await response.text();
    expect(body).toContain("<html");
    expect(body).not.toContain("e2e-callback");
  });
}

for (const [name, overrides, error] of [
  ["scope without openid", { scope: "email profile" }, "invalid_request"],
  ["a missing code_challenge", { code_challenge: null }, "invalid_request"],
  ["a malformed code_challenge", { code_challenge: "short" }, "invalid_request"],
  ["code_challenge_method=plain", { code_challenge_method: "plain" }, "invalid_request"],
  ["a missing code_challenge_method", { code_challenge_method: null }, "invalid_request"],
  ["response_type=token", { response_type: "token" }, "unsupported_response_type"],
] as const) {
  test(`authorize redirects back with ${error} for ${name}`, async ({ request }) => {
    const state = `state-${randomUUID()}`;
    const response = await request.get(authorizePath({ ...overrides, state }), { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const location = new URL(response.headers()["location"]);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe(error);
    expect(location.searchParams.get("state")).toBe(state);
    expect(location.searchParams.get("code")).toBeNull();
  });
}

test("authorize sends a signed-out user through login and back with a code", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  // Confirming needed a login; start signed out again.
  await page.context().clearCookies();

  const params = authorizeParams();
  const path = `/oauth/authorize?${params}`;
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).pathname).toBe("/login");
  expect(new URL(page.url()).searchParams.get("next")).toBe(path);

  await submitLogin(page, email);
  await page.waitForURL((url) => url.href.startsWith(`${REDIRECT_URI}?`));
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(params.get("state"));
  expect(callback.searchParams.get("code")).toMatch(/^[\w-]{43}$/);
  expect(callback.searchParams.get("error")).toBeNull();

  // Signed in now: authorize issues a fresh code straight away.
  const again = await page.request.get(path, { maxRedirects: 0 });
  expect(again.status()).toBe(302);
  const location = new URL(again.headers()["location"]);
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
  expect(location.searchParams.get("code")).toMatch(/^[\w-]{43}$/);
  expect(location.searchParams.get("code")).not.toBe(callback.searchParams.get("code"));
});

test("authorize with prompt=login shows the login page to a signed-in user", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  // Confirming needs a login, so the page is signed in from here on.
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();

  const params = authorizeParams();
  await page.goto(`/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(params), prompt: "login" })}`);
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(`/oauth/authorize?${params}`);
  await expect(page.getByLabel("パスワード", { exact: true })).toBeVisible();

  await submitLogin(page, email);
  await page.waitForURL((url) => url.href.startsWith(`${REDIRECT_URI}?`));
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(params.get("state"));
  expect(callback.searchParams.get("code")).toMatch(/^[\w-]{43}$/);
});

test("authorize uses the NEXT_LOCALE cookie for the login page", async ({ page, context }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "zh-cn", url: ISSUER }]);
  const path = authorizePath();
  const response = await page.request.get(path, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  const location = new URL(response.headers()["location"], ISSUER);
  expect(location.pathname).toBe("/zh-cn/login");
  expect(location.searchParams.get("next")).toBe(path);
});

test("authorize sends a user with an unconfirmed email to the account page", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await page.goto("/login");
  await submitLogin(page, email);
  await expect(page).toHaveURL(/\/account$/);

  await page.goto(authorizePath());
  await expect(page).toHaveURL(/\/account\?verify=required$/);
  await expect(page.getByText("サービスにログインするには、メールアドレスの確認が必要です。")).toBeVisible();
});

function expectClientRedirect(response: Awaited<ReturnType<APIRequestContext["get"]>>, state: string) {
  expect(response.status()).toBe(302);
  const location = new URL(response.headers()["location"]);
  expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
  expect(location.searchParams.get("state")).toBe(state);
  return location;
}

test("authorize with prompt=none issues a code to a signed-in user", async ({ page }) => {
  await signedInUser(page);
  const state = `state-${randomUUID()}`;
  const response = await page.request.get(authorizePath({ prompt: "none", state }), { maxRedirects: 0 });
  const location = expectClientRedirect(response, state);
  expect(location.searchParams.get("code")).toMatch(/^[\w-]{43}$/);
  expect(location.searchParams.get("error")).toBeNull();
});

test("authorize with prompt=none returns login_required to a signed-out user", async ({ request }) => {
  const state = `state-${randomUUID()}`;
  const location = expectClientRedirect(await request.get(authorizePath({ prompt: "none", state }), { maxRedirects: 0 }), state);
  expect(location.searchParams.get("error")).toBe("login_required");
  expect(location.searchParams.get("code")).toBeNull();
});

test("authorize with prompt=none returns interaction_required for an unconfirmed email", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await page.goto("/login");
  await submitLogin(page, email);
  await expect(page).toHaveURL(/\/account$/);

  const state = `state-${randomUUID()}`;
  const location = expectClientRedirect(
    await page.request.get(authorizePath({ prompt: "none", state }), { maxRedirects: 0 }),
    state,
  );
  expect(location.searchParams.get("error")).toBe("interaction_required");
  expect(location.searchParams.get("code")).toBeNull();
});

test("authorize rejects prompt=none together with login", async ({ page }) => {
  await signedInUser(page);
  const state = `state-${randomUUID()}`;
  const location = expectClientRedirect(
    await page.request.get(authorizePath({ prompt: "none login", state }), { maxRedirects: 0 }),
    state,
  );
  expect(location.searchParams.get("error")).toBe("invalid_request");
  expect(location.searchParams.get("code")).toBeNull();
});

test("authorize with prompt=none returns login_required for a revoked session", async ({ page, browser }) => {
  const email = await signedInUser(page);
  const headers = { "x-forwarded-for": `e2e-${randomUUID()}` };

  // Reset the password from another browser: that revokes every session, including this page's cookie.
  const other = await browser.newContext({ extraHTTPHeaders: headers });
  const otherPage = await other.newPage();
  const before = (await readMails()).length;
  await otherPage.goto("/forgot");
  await otherPage.getByLabel("メールアドレス", { exact: true }).fill(email);
  await otherPage.getByRole("button", { name: "再設定メールを送る" }).click();
  await expect(otherPage.getByRole("heading", { name: "メールを送りました" })).toBeVisible();
  const { link } = await lastMailTo(email, "resetPassword", { after: before });
  await otherPage.goto(link);
  await otherPage.getByLabel("新しいパスワード").fill("a brand new password");
  await otherPage.getByRole("button", { name: "パスワードを設定" }).click();
  await expect(otherPage).toHaveURL(/\/login\?reset=done$/);
  await other.close();

  const state = `state-${randomUUID()}`;
  const location = expectClientRedirect(
    await page.request.get(authorizePath({ prompt: "none", state }), { maxRedirects: 0 }),
    state,
  );
  expect(location.searchParams.get("error")).toBe("login_required");
});

const CLIENT_SECRET = process.env.E2E_OIDC_CLIENT_SECRET ?? "e2e-secret";

function basic(id: string, secret: string) {
  // RFC 6749 §2.3.1: form-urlencode each part before base64.
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
  return `Basic ${Buffer.from(`${encode(id)}:${encode(secret)}`).toString("base64")}`;
}

/** Signs up a confirmed user and leaves the page signed in. */
async function signedInUser(page: Page) {
  const email = newEmail();
  await signUp(page, email);
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

/** Runs authorize for the signed-in page and returns the code with its PKCE verifier and nonce. */
async function obtainCode(page: Page) {
  const verifier = randomBytes(32).toString("base64url");
  const nonce = `nonce-${randomUUID()}`;
  const response = await page.request.get(
    authorizePath({ nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url") }),
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(302);
  const code = new URL(response.headers()["location"]).searchParams.get("code");
  expect(code).toMatch(/^[\w-]{43}$/);
  return { code: code as string, verifier, nonce };
}

function tokenForm(code: string, verifier: string, overrides: Record<string, string> = {}) {
  return {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    ...overrides,
  };
}

function decodeSegment(segment: string) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

async function verifyWithJwks(request: APIRequestContext, token: string) {
  const [header, payload, signature] = token.split(".");
  const { kid, alg } = decodeSegment(header);
  expect(alg).toBe("ES256");
  const { keys } = await (await request.get("/oauth/jwks")).json();
  const jwk = keys.find((key: { kid: string }) => key.kid === kid);
  expect(jwk).toBeDefined();
  const ok = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  expect(ok).toBe(true);
  return decodeSegment(payload);
}

test("token exchanges a code for a signed ID token and access token", async ({ page, request }) => {
  const email = await signedInUser(page);
  const { code, verifier, nonce } = await obtainCode(page);
  const before = Math.floor(Date.now() / 1000);

  const response = await request.post("/oauth/token", {
    headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
    form: tokenForm(code, verifier),
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({ token_type: "Bearer", expires_in: 300, scope: "openid email profile" });

  const idToken = await verifyWithJwks(request, body.id_token);
  expect(idToken).toMatchObject({
    iss: ISSUER,
    aud: CLIENT_ID,
    email,
    email_verified: true,
    name: "おーあいでぃーしー",
    nonce,
  });
  expect(typeof idToken.sub).toBe("string");
  expect(idToken.iat).toBeGreaterThanOrEqual(before - 5);
  expect(idToken.exp - idToken.iat).toBe(300);
  expect(idToken.auth_time).toBeLessThanOrEqual(idToken.iat);

  const accessToken = await verifyWithJwks(request, body.access_token);
  expect(accessToken).toMatchObject({
    iss: ISSUER,
    sub: idToken.sub,
    aud: `${ISSUER}/oauth/userinfo`,
    client_id: CLIENT_ID,
    scope: "openid email profile",
  });

  // The same code a second time.
  const again = await request.post("/oauth/token", {
    headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
    form: tokenForm(code, verifier),
  });
  expect(again.status()).toBe(400);
  expect(await again.json()).toMatchObject({ error: "invalid_grant" });
});

test("token accepts client_secret_post", async ({ page, request }) => {
  await signedInUser(page);
  const { code, verifier } = await obtainCode(page);
  const response = await request.post("/oauth/token", {
    form: tokenForm(code, verifier, { client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).token_type).toBe("Bearer");
});

test("token lets only one of two concurrent redemptions succeed", async ({ page, request }) => {
  await signedInUser(page);
  const { code, verifier } = await obtainCode(page);
  const post = () =>
    request.post("/oauth/token", {
      headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
      form: tokenForm(code, verifier),
    });
  const statuses = (await Promise.all([post(), post(), post()])).map((response) => response.status());
  expect(statuses.sort()).toEqual([200, 400, 400]);
});

for (const [name, overrides] of [
  ["a wrong code_verifier", { code_verifier: randomBytes(32).toString("base64url") }],
  ["a wrong redirect_uri", { redirect_uri: `${ISSUER}/e2e-callback/other` }],
] as const) {
  test(`token rejects ${name} with invalid_grant`, async ({ page, request }) => {
    await signedInUser(page);
    const { code, verifier } = await obtainCode(page);
    const response = await request.post("/oauth/token", {
      headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
      form: tokenForm(code, verifier, overrides),
    });
    expect(response.status()).toBe(400);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });
}

test("token rejects an unknown code with invalid_grant", async ({ request }) => {
  const response = await request.post("/oauth/token", {
    headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
    form: tokenForm(randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")),
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: "invalid_grant" });
});

for (const [name, auth] of [
  ["a wrong Basic secret", { headers: { Authorization: basic(CLIENT_ID, "wrong-secret") } }],
  ["a wrong client_secret_post secret", { form: { client_id: CLIENT_ID, client_secret: "wrong-secret" } }],
  ["an unknown client", { headers: { Authorization: basic("no-such-client", CLIENT_SECRET) } }],
  ["no client authentication", {}],
] as const) {
  test(`token rejects ${name} with invalid_client`, async ({ request }) => {
    const form = {
      grant_type: "authorization_code",
      code: randomBytes(32).toString("base64url"),
      redirect_uri: REDIRECT_URI,
      code_verifier: randomBytes(32).toString("base64url"),
      ...("form" in auth ? auth.form : {}),
    };
    const response = await request.post("/oauth/token", {
      headers: "headers" in auth ? auth.headers : {},
      form,
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
  });
}

test("token rejects a wrong secret without consuming the code", async ({ page, request }) => {
  await signedInUser(page);
  const { code, verifier } = await obtainCode(page);
  const wrong = await request.post("/oauth/token", {
    headers: { Authorization: basic(CLIENT_ID, "wrong-secret") },
    form: tokenForm(code, verifier),
  });
  expect(wrong.status()).toBe(401);
  const right = await request.post("/oauth/token", {
    headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
    form: tokenForm(code, verifier),
  });
  expect(right.status()).toBe(200);
});

test("token rejects grant_type=password with unsupported_grant_type", async ({ request }) => {
  const response = await request.post("/oauth/token", {
    headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
    form: { grant_type: "password", username: "someone@example.com", password: PASSWORD },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: "unsupported_grant_type" });
});

test("userinfo returns the current profile for the access token", async ({ page, request }) => {
  const email = await signedInUser(page);
  const { code, verifier } = await obtainCode(page);
  const tokens = await (
    await request.post("/oauth/token", {
      headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
      form: tokenForm(code, verifier),
    })
  ).json();
  const authorization = { Authorization: `Bearer ${tokens.access_token}` };

  const first = await request.get("/oauth/userinfo", { headers: authorization });
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toBe("no-store");
  const sub = decodeSegment(tokens.id_token.split(".")[1]).sub;
  expect(await first.json()).toEqual({ sub, email, email_verified: true, name: "おーあいでぃーしー" });

  // A new display name shows up straight away with the same token.
  await page.goto("/account");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "表示名を変更" }) });
  await form.getByLabel("新しい表示名").fill("あたらしいなまえ");
  await form.getByRole("button", { name: "表示名を変更" }).click();
  await expect(form.getByRole("status")).toHaveText("表示名を変更しました。");
  const second = await request.get("/oauth/userinfo", { headers: authorization });
  expect(second.status()).toBe(200);
  expect((await second.json()).name).toBe("あたらしいなまえ");

  // The ID token is not an access token for userinfo.
  const withIdToken = await request.get("/oauth/userinfo", {
    headers: { Authorization: `Bearer ${tokens.id_token}` },
  });
  expect(withIdToken.status()).toBe(401);
});

test("userinfo rejects a missing or tampered token", async ({ page, request }) => {
  const missing = await request.get("/oauth/userinfo");
  expect(missing.status()).toBe(401);
  expect(missing.headers()["www-authenticate"]).toBe('Bearer error="invalid_token"');

  await signedInUser(page);
  const { code, verifier } = await obtainCode(page);
  const { access_token: accessToken } = await (
    await request.post("/oauth/token", {
      headers: { Authorization: basic(CLIENT_ID, CLIENT_SECRET) },
      form: tokenForm(code, verifier),
    })
  ).json();
  const [header, payload, signature] = accessToken.split(".");
  const claims = decodeSegment(payload);
  const forged = Buffer.from(JSON.stringify({ ...claims, sub: "someone-else" })).toString("base64url");
  const tampered = await request.get("/oauth/userinfo", {
    headers: { Authorization: `Bearer ${header}.${forged}.${signature}` },
  });
  expect(tampered.status()).toBe(401);
  expect(tampered.headers()["www-authenticate"]).toBe('Bearer error="invalid_token"');
});
