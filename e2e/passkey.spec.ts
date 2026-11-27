import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { newEmail, PASSWORD, signedInUser, signUp, testIp } from "./helpers/account";
import { ageSession, sessionExists } from "./helpers/db";
import { totp } from "./helpers/totp";
import { addVirtualAuthenticator } from "./helpers/webauthn";

const ISSUER = "http://localhost:3000";
const REDIRECT_URI = `${ISSUER}/e2e-callback`;
const CODE = /^[A-Za-z0-9]{32}$/;

// Each test gets its own client IP so per-IP throttles never trip.
test.use({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": testIp() });
  },
});

function authorizeParams(overrides: Record<string, string> = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: "e2e-client",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state: `state-${randomUUID()}`,
    nonce: `nonce-${randomUUID()}`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...overrides,
  });
  return Object.assign(params, { verifier });
}

/** Redeems the code at the client's callback and reads auth_time from the ID token. */
async function authTime(request: APIRequestContext, callback: URL, verifier: string) {
  const response = await request.post("/oauth/token", {
    headers: { Authorization: `Basic ${Buffer.from("e2e-client:e2e-secret").toString("base64")}` },
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") ?? "",
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    },
  });
  expect(response.status()).toBe(200);
  const { id_token: idToken } = await response.json();
  return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")).auth_time as number;
}

async function addPasskey(page: Page, name = "テスト用の指紋") {
  await page.goto("/account");
  await page.getByLabel("パスキーの名前").fill(name);
  await page.getByRole("button", { name: "パスキーを追加" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
}

async function logOut(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * A virtual authenticator answers the conditional UI (the email field's autofill) on its own, which would sign in
 * at the same time as the button does. The tests that press the button switch the conditional UI off; the
 * conditional UI has its own test.
 */
async function withoutConditionalUi(page: Page) {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });
}

async function signInWithPasskey(page: Page) {
  await page.getByRole("button", { name: "パスキー（指紋）でログイン" }).click();
}

test("registers a passkey on the account page and signs in with it", async ({ page }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  await signedInUser(page);
  await addPasskey(page);

  await logOut(page);
  await page.goto("/login");
  await signInWithPasskey(page);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "マイページ" })).toBeVisible();
});

test("passkey sign-in from authorize returns a code", async ({ page }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  await signedInUser(page);
  await addPasskey(page);
  await logOut(page);

  const params = authorizeParams();
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page).toHaveURL(/\/login\?/);
  await signInWithPasskey(page);
  await expect(page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(params.get("state"));
  expect(callback.searchParams.get("code")).toMatch(CODE);
});

test("prompt=login then passkey returns a code with a fresh auth_time", async ({ page, request }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  await signedInUser(page);
  await addPasskey(page);

  const cookieOf = async () => (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  const first = authorizeParams();
  await page.goto(`/oauth/authorize?${first}`);
  await expect(page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
  const before = await authTime(request, new URL(page.url()), first.verifier);
  const oldToken = decodeURIComponent((await cookieOf())?.value ?? "").split(".")[0];
  expect(await sessionExists(oldToken)).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const second = authorizeParams({ prompt: "login" });
  await page.goto(`/oauth/authorize?${second}`);
  await expect(page).toHaveURL(/\/login\?.*reauth=1/);
  await signInWithPasskey(page);
  await expect(page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
  const callback = new URL(page.url());
  expect(callback.searchParams.get("code")).toMatch(CODE);
  expect(callback.searchParams.get("state")).toBe(second.get("state"));
  expect(await authTime(request, callback, second.verifier)).toBeGreaterThan(before);
  // The session the passkey sign-in replaced is gone, as after a password reauth.
  expect(await sessionExists(oldToken)).toBe(false);
});

test("passkey login with unconfirmed email does not get a code", async ({ page }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  const email = newEmail();
  await signUp(page, email);
  await page.goto("/login");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await addPasskey(page);
  await logOut(page);

  await page.goto(`/oauth/authorize?${authorizeParams()}`);
  await expect(page).toHaveURL(/\/login\?/);
  await signInWithPasskey(page);
  await expect(page).toHaveURL(/\/account\?verify=required$/);
});

test("the email field offers the passkey and signing in with it needs no button", async ({ page }) => {
  await addVirtualAuthenticator(page);
  await signedInUser(page);
  await addPasskey(page);
  await logOut(page);

  await page.goto("/login");
  await expect(page.getByLabel("メールアドレス", { exact: true })).toHaveAttribute("autocomplete", "username webauthn");
  // The virtual authenticator answers the conditional request itself.
  await expect(page).toHaveURL(/\/account$/);
});

test("adding a passkey with an old session asks for a fresh login and then succeeds", async ({ page }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  const email = await signedInUser(page);
  const cookie = (await page.context().cookies()).find((c) => c.name.endsWith("session_token"));
  const oldToken = decodeURIComponent(cookie?.value ?? "").split(".")[0];
  expect(await ageSession(oldToken)).toBe(1);

  await page.goto("/account");
  await page.getByLabel("パスキーの名前").fill("古いセッション");
  await page.getByRole("button", { name: "パスキーを追加" }).click();
  await expect(page).toHaveURL(/\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/account");
  await expect(page.getByText("パスキーを追加するには、もう一度ログインしてください。")).toBeVisible();

  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  // The old session is replaced, not left behind.
  expect(await sessionExists(oldToken)).toBe(false);

  await addPasskey(page, "新しいセッション");
});

test("another 403 while adding a passkey shows the failure message, not the login page", async ({ page }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  await signedInUser(page);
  await page.route("**/passkey/generate-register-options*", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "INVALID_ORIGIN", message: "Invalid origin" }) }),
  );
  await page.goto("/account");
  await page.getByRole("button", { name: "パスキーを追加" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "パスキーの操作ができませんでした" })).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
});

test("passkey login does not ask for the 2FA code", async ({ page }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  await signedInUser(page);
  await addPasskey(page);
  const area = page.getByRole("region", { name: "二要素認証" });
  await area.getByLabel("今のパスワード").fill(PASSWORD);
  await area.getByRole("button", { name: "二要素認証をオンにする" }).click();
  const secret = (await area.getByTestId("totp-secret").textContent())?.replace(/\s/g, "") ?? "";
  await area.getByLabel("認証アプリのコード").fill(totp(secret));
  await area.getByRole("button", { name: "確認してオンにする" }).click();
  await expect(area.getByText("二要素認証はオンです。")).toBeVisible();
  await logOut(page);

  // From a client too: the passkey sign-in goes straight on to the code.
  const params = authorizeParams();
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page).toHaveURL(/\/login\?/);
  await signInWithPasskey(page);
  await expect(page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
  expect(new URL(page.url()).searchParams.get("code")).toMatch(CODE);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
});

test("deleting the passkey stops it from signing in", async ({ page }) => {
  await withoutConditionalUi(page);
  await addVirtualAuthenticator(page);
  await signedInUser(page);
  await addPasskey(page, "消す指紋");
  await page.getByRole("listitem").filter({ hasText: "消す指紋" }).getByRole("button", { name: "削除" }).click();
  await expect(page.getByText("消す指紋")).toHaveCount(0);

  await logOut(page);
  await signInWithPasskey(page);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
