import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { newEmail, PASSWORD, signedInUser, testIp } from "./helpers/account";
import { emailOf, passwordHashOf, sessionCountOf, userIdOf } from "./helpers/db";
import { lastMailTo, readMails } from "./helpers/mail-log";
import { confirmEmailLink } from "./helpers/verify";

// The Better Auth endpoints that only the app's server actions call answer 404 over HTTP
// (lib/id/server-only-endpoints.ts): the actions' checks cannot be skipped by calling them from the browser.

const ISSUER = "http://localhost:3000";
const headers = { Origin: ISSUER };

test.use({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": testIp() });
  },
});

async function requestEmailChange(page: Page, email: string) {
  await page.goto("/account");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "メールアドレスを変更" }) });
  await form.getByLabel("新しいメールアドレス").fill(email);
  await form.getByLabel("今のパスワード").fill(PASSWORD);
  await form.getByRole("button", { name: "メールアドレスを変更" }).click();
  await expect(form.getByRole("status")).toContainText(email);
}

test("an email change link cannot be redeemed at /api/auth/verify-email, with or without a session", async ({
  page,
  request,
}) => {
  const email = await signedInUser(page);
  const userId = (await userIdOf(email)) as string;
  const nextEmail = newEmail();
  await requestEmailChange(page, nextEmail);
  const { link } = await lastMailTo(nextEmail, "changeEmail");
  const token = new URL(link).searchParams.get("token") as string;

  for (const context of [request, page.request]) {
    const response = await context.get(`/api/auth/verify-email?${new URLSearchParams({ token, callbackURL: "/" })}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(404);
  }
  expect(await emailOf(userId)).toBe(email);

  // The link still works where the app completes it.
  await confirmEmailLink(page, link);
  await expect(page.getByRole("heading", { name: "メールアドレスを変更しました" })).toBeVisible();
  expect(await emailOf(userId)).toBe(nextEmail);
});

test("a sign-up verify link cannot be redeemed at /api/auth/verify-email either", async ({ page, request }) => {
  const email = newEmail();
  await page.goto("/signup");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("表示名").fill("さーばーおんりー");
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("確認メールを送りました")).toBeVisible();
  const token = new URL((await lastMailTo(email, "verify")).link).searchParams.get("token") as string;
  const response = await request.get(`/api/auth/verify-email?${new URLSearchParams({ token })}`, { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

test("a signed-in browser cannot call /api/auth/change-email or /api/auth/change-password itself", async ({ page }) => {
  const email = await signedInUser(page);
  const userId = (await userIdOf(email)) as string;
  const mailsBefore = (await readMails()).length;
  const hashBefore = await passwordHashOf(email);
  const sessionsBefore = await sessionCountOf(userId);

  const nextEmail = newEmail();
  const changeEmail = await page.request.post("/api/auth/change-email", {
    headers,
    data: { newEmail: nextEmail, callbackURL: "/" },
  });
  expect(changeEmail.status()).toBe(404);

  // A short password, other sessions kept: both what the action never allows.
  const changePassword = await page.request.post("/api/auth/change-password", {
    headers,
    data: { currentPassword: PASSWORD, newPassword: "x", revokeOtherSessions: false },
  });
  expect(changePassword.status()).toBe(404);

  expect((await readMails()).slice(mailsBefore).filter((mail) => mail.to === nextEmail || mail.to === email)).toEqual([]);
  expect(await emailOf(userId)).toBe(email);
  expect(await passwordHashOf(email)).toBe(hashBefore);
  expect(await sessionCountOf(userId)).toBe(sessionsBefore);
});

test("the other endpoints the server actions use answer 404 over HTTP", async ({ page, request }) => {
  const email = await signedInUser(page);
  const userId = (await userIdOf(email)) as string;
  const signUpEmail = `server-only-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;

  const signUp = await request.post("/api/auth/sign-up/email", {
    headers,
    data: { email: signUpEmail, password: "x", name: "  " },
  });
  expect(signUp.status()).toBe(404);
  expect(await userIdOf(signUpEmail)).toBeUndefined();

  const signedIn: [string, Record<string, unknown>][] = [
    ["/api/auth/update-user", { name: "   " }],
    ["/api/auth/verify-password", { password: PASSWORD }],
    ["/api/auth/send-verification-email", { email }],
  ];
  for (const [path, data] of signedIn) {
    expect((await page.request.post(path, { headers, data })).status(), path).toBe(404);
  }

  const mailsBefore = (await readMails()).length;
  expect((await request.post("/api/auth/request-password-reset", { headers, data: { email } })).status()).toBe(404);
  expect((await readMails()).slice(mailsBefore).filter((mail) => mail.to === email)).toEqual([]);
  expect(
    (await request.post("/api/auth/reset-password", { headers, data: { token: "x".repeat(24), newPassword: "x" } })).status(),
  ).toBe(404);
  expect((await request.get(`/api/auth/reset-password/${"x".repeat(24)}?callbackURL=/`, { maxRedirects: 0 })).status()).toBe(404);

  expect(await emailOf(userId)).toBe(email);
});

test("the endpoints the browser uses still answer over HTTP", async ({ request }) => {
  expect((await request.get("/api/auth/ok")).status()).toBe(200);
  expect((await request.get("/api/auth/get-session")).status()).toBe(200);
  // A wrong password is a 401 from Better Auth itself, not a 404.
  const signIn = await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email: newEmail(), password: "not the password at all" },
  });
  expect(signIn.status()).toBe(401);
});
