import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { hashToken } from "../lib/id/tokens";
import { lastMailTo } from "./helpers/mail-log";
import { confirmEmailLink } from "./helpers/verify";

const ISSUER = "http://localhost:3000";
const CLIENT_ID = "e2e-client";
const POST_LOGOUT_URI = `${ISSUER}/e2e-signed-out`;
const PASSWORD = "  twelve chars  ";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/sparklingstadt_id",
});
test.afterAll(() => pool.end());

async function sessionRows(token: string): Promise<number> {
  const { rows } = await pool.query("select count(*)::int as n from sessions where token_hash = $1", [hashToken(token)]);
  return rows[0].n;
}

// Each test gets its own client IP so per-IP throttles never trip.
test.use({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": `e2e-${randomUUID()}` });
  },
});

function logoutPath(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    client_id: CLIENT_ID,
    post_logout_redirect_uri: POST_LOGOUT_URI,
    state: "s",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null) params.set(key, value);
  return `/oauth/logout?${params}`;
}

/** Signs up, confirms the address and ends up signed in. */
async function signedInUser(page: Page) {
  const email = `logout-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("表示名").fill("ろぐあうと");
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("確認メールを送りました")).toBeVisible();
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  return email;
}

async function sessionToken(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "sid_session");
  expect(cookie).toBeDefined();
  return cookie!.value;
}

function authorizePath() {
  const verifier = randomBytes(32).toString("base64url");
  return `/oauth/authorize?${new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${ISSUER}/e2e-callback`,
    response_type: "code",
    scope: "openid",
    state: "a",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  })}`;
}

test("logout ends the session and returns to the registered URI with state", async ({ page }) => {
  await signedInUser(page);
  const token = await sessionToken(page);
  expect(await sessionRows(token)).toBe(1);

  const response = await page.request.get(logoutPath(), { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe(`${POST_LOGOUT_URI}?state=s`);
  expect(response.headers()["cache-control"]).toBe("no-store");

  expect((await page.context().cookies()).find((c) => c.name === "sid_session")).toBeUndefined();
  expect(await sessionRows(token)).toBe(0);

  // The next authorize asks for a login again.
  await page.goto(authorizePath());
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("logout without a session still redirects", async ({ request }) => {
  const response = await request.get(logoutPath(), { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe(`${POST_LOGOUT_URI}?state=s`);
});

test("logout to an unregistered URI shows the signed-out page", async ({ page }) => {
  await page.goto(logoutPath({ post_logout_redirect_uri: "https://evil.example/" }));
  expect(new URL(page.url()).pathname).toBe("/signed-out");
  await expect(page.getByRole("heading", { name: "ログアウトしました" })).toBeVisible();
});

test("logout with no parameters shows the signed-out page", async ({ page }) => {
  await page.goto("/oauth/logout");
  expect(new URL(page.url()).pathname).toBe("/signed-out");
});

test("logout shows the signed-out page in the chosen language", async ({ page }) => {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "zh-tw", url: ISSUER }]);
  await page.goto("/oauth/logout");
  expect(new URL(page.url()).pathname).toBe("/zh-tw/signed-out");
  await expect(page.getByRole("heading", { name: "已登出" })).toBeVisible();
});

/** Runs the code flow for the signed-in page and returns the ID token the client would hold. */
async function obtainIdToken(page: Page): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const authorize = await page.request.get(
    `/oauth/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: `${ISSUER}/e2e-callback`,
      response_type: "code",
      scope: "openid",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    })}`,
    { maxRedirects: 0 },
  );
  const code = new URL(authorize.headers()["location"]).searchParams.get("code") as string;
  const token = await page.request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: `${ISSUER}/e2e-callback`,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      client_secret: "e2e-secret",
    },
  });
  expect(token.status()).toBe(200);
  return (await token.json()).id_token;
}

test("logout with only an id_token_hint returns to that client's registered URI", async ({ page }) => {
  await signedInUser(page);
  const idToken = await obtainIdToken(page);
  const token = await sessionToken(page);

  const response = await page.request.get(logoutPath({ client_id: null, id_token_hint: idToken }), {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe(`${POST_LOGOUT_URI}?state=s`);
  expect(await sessionRows(token)).toBe(0);
});

test("logout does not redirect when the id_token_hint is forged or names another client", async ({ page }) => {
  await signedInUser(page);
  const idToken = await obtainIdToken(page);
  // client-b's own registered URI: it would be a valid target if the hint really named client-b.
  const clientB = { post_logout_redirect_uri: `${ISSUER}/client-b-signed-out` };

  // A hint whose audience was changed to client-b after signing.
  const [header, payload, signature] = idToken.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const forgedPayload = Buffer.from(JSON.stringify({ ...claims, aud: "client-b" })).toString("base64url");
  const tampered = await page.request.get(
    logoutPath({ ...clientB, client_id: null, id_token_hint: `${header}.${forgedPayload}.${signature}` }),
    { maxRedirects: 0 },
  );
  expect(tampered.status()).toBe(302);
  expect(tampered.headers()["location"]).toBe("/signed-out");

  // A genuine hint for e2e-client, but the request claims to be client-b.
  const mismatch = await page.request.get(logoutPath({ ...clientB, client_id: "client-b", id_token_hint: idToken }), {
    maxRedirects: 0,
  });
  expect(mismatch.status()).toBe(302);
  expect(mismatch.headers()["location"]).toBe("/signed-out");

  // Control: without the hint, client-b's URI is a valid target for client-b.
  const control = await page.request.get(logoutPath({ ...clientB, client_id: "client-b" }), { maxRedirects: 0 });
  expect(control.headers()["location"]).toBe(`${ISSUER}/client-b-signed-out?state=s`);
});
