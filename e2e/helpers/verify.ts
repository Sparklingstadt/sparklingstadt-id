import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** The confirm buttons on /verify (ja): signup verification and email change. */
export const CONFIRM_BUTTON = /^メールアドレスを(確認|変更)する$/;

/**
 * Opens a mailed verify / change_email link and presses the confirm button (opening alone confirms nothing).
 * Only the account the link is for can confirm it: pass `login` when the page is signed out, and it
 * logs in on the page the link leads to first.
 */
export async function confirmEmailLink(page: Page, link: string, login?: { email: string; password: string }) {
  await page.goto(link);
  if (login && new URL(page.url()).pathname.endsWith("/login")) {
    await expect(page.getByRole("status")).toHaveText("メールアドレスを確認するには、そのSparklingstadt IDでログインしてください。");
    await page.getByLabel("メールアドレス", { exact: true }).fill(login.email);
    await page.getByLabel("パスワード", { exact: true }).fill(login.password);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
  }
  const button = page.getByRole("button", { name: CONFIRM_BUTTON });
  await expect(button).toBeVisible();
  await button.click();
}

/**
 * The same verify / email change link with its token's lifetime run out. The token is a signed message, so a test cannot
 * move its clock in a row: it signs a copy (same claims, expiry in the past) with the server's secret.
 */
export function expiredCopyOfLink(link: string): string {
  const url = new URL(link);
  const [header, body] = (url.searchParams.get("token") ?? "").split(".");
  const payload = { ...JSON.parse(Buffer.from(body, "base64url").toString()), exp: Math.floor(Date.now() / 1000) - 1 };
  const signed = `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(signed).digest("base64url");
  url.searchParams.set("token", `${signed}.${signature}`);
  return url.toString();
}
