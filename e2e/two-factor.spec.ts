import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PASSWORD, signedInUser, testIp } from "./helpers/account";
import { sessionExists } from "./helpers/db";
import { lastMailTo, readMails } from "./helpers/mail-log";
import { secretOf, totp, wrongTotp } from "./helpers/totp";

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
  return new URLSearchParams({
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
}

const section = (page: Page): Locator => page.getByRole("region", { name: "二要素認証" });

/** Turns 2FA on from the account page; returns the TOTP secret and the backup codes shown. */
async function enableTwoFactor(page: Page, password = PASSWORD) {
  await page.goto("/account");
  const area = section(page);
  await expect(area.getByText("二要素認証はオフです。")).toBeVisible();
  await area.getByLabel("今のパスワード").fill(password);
  await area.getByRole("button", { name: "二要素認証をオンにする" }).click();
  await expect(area.getByRole("img", { name: "認証アプリ用の QR コード" })).toBeVisible();
  const secret = (await area.getByTestId("totp-secret").textContent())?.replace(/\s/g, "") ?? "";
  const uri = (await area.getByTestId("totp-secret").getAttribute("data-uri")) ?? "";
  expect(secretOf(uri)).toBe(secret);
  await area.getByLabel("認証アプリのコード").fill(totp(secret));
  await area.getByRole("button", { name: "確認してオンにする" }).click();
  await expect(area.getByText("二要素認証はオンです。")).toBeVisible();
  const backupCodes = (await area.getByTestId("backup-code").allTextContents()).map((code) => code.trim());
  return { secret, backupCodes };
}

async function logOut(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function submitPassword(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

/** Sends the code and waits for the answer (the form clears itself afterwards, so the next code waits for that). */
async function sendCode(page: Page, label: string, code: string) {
  await page.getByLabel(label).fill(code);
  const answered = page.waitForResponse((response) => response.url().includes("/api/auth/two-factor/verify-"));
  await page.getByRole("button", { name: "確認する" }).click();
  await answered;
}

const submitTotp = (page: Page, code: string) => sendCode(page, "認証アプリのコード", code);

async function submitBackupCode(page: Page, code: string) {
  await page.getByRole("button", { name: "バックアップコードを使う" }).click();
  await sendCode(page, "バックアップコード", code);
}

const sessionCookie = async (page: Page) =>
  (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));

test("enables 2FA with a TOTP and shows 10 backup codes once", async ({ page }) => {
  await signedInUser(page);
  const { backupCodes } = await enableTwoFactor(page);
  expect(backupCodes).toHaveLength(10);
  expect(new Set(backupCodes).size).toBe(10);
  for (const code of backupCodes) expect(code).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);

  await page.goto("/account");
  await expect(section(page).getByText("二要素認証はオンです。")).toBeVisible();
  await expect(section(page).getByTestId("backup-code")).toHaveCount(0);
  for (const code of backupCodes.slice(0, 3)) await expect(page.getByText(code)).toHaveCount(0);
});

test("a wrong code while enabling keeps 2FA off", async ({ page }) => {
  await signedInUser(page);
  await page.goto("/account");
  const area = section(page);
  await area.getByLabel("今のパスワード").fill("not the password at all");
  await area.getByRole("button", { name: "二要素認証をオンにする" }).click();
  await expect(area.getByRole("alert")).toHaveText("パスワードが正しくありません。");

  await area.getByLabel("今のパスワード").fill(PASSWORD);
  await area.getByRole("button", { name: "二要素認証をオンにする" }).click();
  const secret = (await area.getByTestId("totp-secret").textContent())?.replace(/\s/g, "") ?? "";
  await area.getByLabel("認証アプリのコード").fill(wrongTotp(secret));
  await area.getByRole("button", { name: "確認してオンにする" }).click();
  await expect(area.getByRole("alert")).toHaveText("コードが正しくありません。");

  await page.goto("/account");
  await expect(section(page).getByText("二要素認証はオフです。")).toBeVisible();
});

test("password sign-in asks for the TOTP and succeeds with it", async ({ page }) => {
  const email = await signedInUser(page);
  const { secret } = await enableTwoFactor(page);
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/two-factor$/);
  expect(await sessionCookie(page)).toBeUndefined();
  // The password alone does not open the account page.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?/);

  await page.goto("/login");
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
  await submitTotp(page, totp(secret));
  await expect(page).toHaveURL(/\/account$/);
  await expect(section(page).getByText("二要素認証はオンです。")).toBeVisible();
});

test("the 2FA page keeps the language of the login page", async ({ page }) => {
  const email = await signedInUser(page);
  await enableTwoFactor(page);
  await logOut(page);

  await page.goto("/zh-tw/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("form button[type=submit]").first().click();
  await expect(page).toHaveURL(/\/zh-tw\/two-factor$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
});

test("a wrong TOTP is refused and the 6th try is throttled", async ({ page }) => {
  const email = await signedInUser(page);
  const { secret } = await enableTwoFactor(page);
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await submitTotp(page, wrongTotp(secret));
    await expect(page.locator(".id-alert")).toHaveText("コードが正しくありません。");
  }
  await submitTotp(page, totp(secret));
  await expect(page.locator(".id-alert")).toHaveText("試行回数が多すぎます。しばらくしてからお試しください。");
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
  expect(await sessionCookie(page)).toBeUndefined();
});

test("a backup code works once", async ({ page }) => {
  const email = await signedInUser(page);
  const { backupCodes } = await enableTwoFactor(page);
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await submitBackupCode(page, backupCodes[0]);
  await expect(page).toHaveURL(/\/account$/);
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await submitBackupCode(page, backupCodes[0]);
  await expect(page.locator(".id-alert")).toHaveText("コードが正しくありません。");
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
  // Another of the codes still works.
  await sendCode(page, "バックアップコード", backupCodes[1]);
  await expect(page).toHaveURL(/\/account$/);
});

test("new backup codes replace the old ones", async ({ page }) => {
  const email = await signedInUser(page);
  const { backupCodes } = await enableTwoFactor(page);
  await page.goto("/account");
  const area = section(page);
  await area.getByLabel("今のパスワード").fill(PASSWORD);
  await area.getByRole("button", { name: "バックアップコードを作り直す" }).click();
  await expect(area.getByTestId("backup-code")).toHaveCount(10);
  const fresh = (await area.getByTestId("backup-code").allTextContents()).map((code) => code.trim());
  expect(fresh.some((code) => backupCodes.includes(code))).toBe(false);
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await submitBackupCode(page, backupCodes[0]);
  await expect(page.locator(".id-alert")).toHaveText("コードが正しくありません。");
  await sendCode(page, "バックアップコード", fresh[0]);
  await expect(page).toHaveURL(/\/account$/);
});

test("authorize with password and 2FA does not issue a code before the TOTP", async ({ page }) => {
  const email = await signedInUser(page);
  const { secret } = await enableTwoFactor(page);
  await logOut(page);

  const toClient: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(REDIRECT_URI)) toClient.push(request.url());
  });
  const params = authorizeParams();
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page).toHaveURL(/\/login\?/);
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
  const next = new URL(page.url()).searchParams.get("next") ?? "";
  expect(next).toBe(`/oauth/authorize?${params}`);
  expect(toClient).toEqual([]);

  // The browser holds no session yet: the authorize URL sends it to the login page, not to the client.
  const early = await page.request.get(next, { maxRedirects: 0 });
  expect(early.status()).toBe(302);
  expect(early.headers().location ?? "").toMatch(/^\/login\?/);
  expect(toClient).toEqual([]);

  await submitTotp(page, totp(secret));
  await page.waitForURL((url) => url.href.startsWith(`${REDIRECT_URI}?`));
  const callback = new URL(page.url());
  expect(callback.searchParams.get("code")).toMatch(CODE);
  expect(callback.searchParams.get("state")).toBe(params.get("state"));
});

test("prompt=login with 2FA ends the replaced session and issues the code after the TOTP", async ({ page }) => {
  const email = await signedInUser(page);
  const { secret } = await enableTwoFactor(page);
  const before = await sessionCookie(page);
  const oldToken = decodeURIComponent(before?.value ?? "").split(".")[0];
  expect(await sessionExists(oldToken)).toBe(true);

  const params = authorizeParams({ prompt: "login" });
  await page.goto(`/oauth/authorize?${params}`);
  await expect(page).toHaveURL(/\/login\?.*reauth=1/);
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/two-factor\?.*reauth=1/);
  await submitTotp(page, totp(secret));
  await page.waitForURL((url) => url.href.startsWith(`${REDIRECT_URI}?`));
  expect(new URL(page.url()).searchParams.get("code")).toMatch(CODE);
  const after = await sessionCookie(page);
  expect(after?.value).not.toBe(before?.value);
  expect(await sessionExists(oldToken)).toBe(false);
});

test("password reset keeps 2FA", async ({ page }) => {
  const email = await signedInUser(page);
  const { secret } = await enableTwoFactor(page);
  await logOut(page);

  const before = (await readMails()).length;
  await page.goto("/forgot");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByRole("button", { name: "再設定メールを送る" }).click();
  await expect(page.getByRole("heading", { name: "メールを送りました" })).toBeVisible();
  await page.goto((await lastMailTo(email, "resetPassword", { after: before })).link);
  await page.getByLabel("新しいパスワード").fill("a brand new password");
  await page.getByRole("button", { name: "パスワードを設定" }).click();
  await expect(page).toHaveURL(/\/login\?reset=done$/);

  await submitPassword(page, email, "a brand new password");
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
  expect(await sessionCookie(page)).toBeUndefined();
  await submitTotp(page, totp(secret));
  await expect(page).toHaveURL(/\/account$/);
});

test("disabling 2FA needs the password and then sign-in skips the code", async ({ page }) => {
  const email = await signedInUser(page);
  await enableTwoFactor(page);
  await page.goto("/account");
  const area = section(page);
  await area.getByLabel("今のパスワード").fill("not the password at all");
  await area.getByRole("button", { name: "二要素認証をオフにする" }).click();
  await expect(area.getByRole("alert")).toHaveText("パスワードが正しくありません。");
  await page.goto("/account");
  await expect(section(page).getByText("二要素認証はオンです。")).toBeVisible();

  await section(page).getByLabel("今のパスワード").fill(PASSWORD);
  await section(page).getByRole("button", { name: "二要素認証をオフにする" }).click();
  await expect(section(page).getByText("二要素認証はオフです。")).toBeVisible();
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/account$/);
});

test("the 2FA page without a pending sign-in asks to log in again", async ({ page }) => {
  await page.goto("/two-factor");
  await submitTotp(page, "123456");
  await expect(page.locator(".id-alert")).toContainText("もう一度ログインしてください");
  await page.getByRole("link", { name: "ログインに戻る" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("asking to trust the device is ignored: the next password sign-in asks for the code again", async ({ page }) => {
  const email = await signedInUser(page);
  const { secret } = await enableTwoFactor(page);
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
  const response = await page.request.post("/api/auth/two-factor/verify-totp", {
    headers: { origin: ISSUER },
    data: { code: totp(secret), trustDevice: true },
  });
  expect(response.status()).toBe(200);
  expect((await page.context().cookies()).find((cookie) => cookie.name.endsWith("trust_device"))).toBeUndefined();
  await logOut(page);

  await page.goto("/login");
  await submitPassword(page, email);
  await expect(page).toHaveURL(/\/two-factor(\?|$)/);
});
