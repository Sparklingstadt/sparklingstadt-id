import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { lastMailTo } from "./mail-log";
import { confirmEmailLink } from "./verify";

export const PASSWORD = "  twelve chars  ";

export function newEmail() {
  return `oidc-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
}

export async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("表示名").fill("おーあいでぃーしー");
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("確認メールを送りました")).toBeVisible();
}

/** Signs up a confirmed user and leaves the page signed in. */
export async function signedInUser(page: Page) {
  const email = newEmail();
  await signUp(page, email);
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

