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
