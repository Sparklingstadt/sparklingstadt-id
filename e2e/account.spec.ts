import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { lastMailTo, readMails } from "./helpers/mail-log";
import { expireMailedLink, passwordHashOf, setPasswordHash, setThrottle } from "./helpers/db";
import { testIp } from "./helpers/account";
import { CONFIRM_BUTTON, confirmEmailLink, expiredCopyOfLink } from "./helpers/verify";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": testIp() });
});

const PASSWORD = "  twelve chars  ";

function newEmail() {
  return `sid-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
}

async function signUp(page: Page, email: string, displayName = "ふわふわ", password = PASSWORD) {
  await page.goto("/signup");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("表示名").fill(displayName);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("確認メールを送りました")).toBeVisible();
}

async function logIn(page: Page, email: string, password = PASSWORD, path = "/login") {
  await page.goto(path);
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

test("signs up, confirms the email and signs in", async ({ page }) => {
  const email = newEmail();
  const local = email.slice(0, email.indexOf("@"));
  await signUp(page, `  ${local.replace("sid", "Sid")}@Example.com  `);

  const { link } = await lastMailTo(email, "verify");
  expect(link).toMatch(/^http:\/\/localhost:3000\/verify\?token=[\w-]+\.[\w-]+\.[\w-]+$/);
  // Signed out: the link asks for the account's login first, then comes back to the button.
  await confirmEmailLink(page, link, { email, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();

  const again = await page.goto(link);
  expect(again?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();

  await page.goto("/account");
  await expect(page.locator(".id-profile").getByText("ふわふわ")).toBeVisible();
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);
});

test("opening the verify link does not confirm the address until the button is pressed", async ({ page, request }) => {
  const email = newEmail();
  await signUp(page, email);
  const { link } = await lastMailTo(email, "verify");

  // A mail scanner or link preview fetches the link (twice, even): nothing changes.
  // Signed out, the link only leads to the login page.
  expect((await request.get(link)).status()).toBeLessThan(500);
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?confirm=1&next=/);

  await logIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toBeVisible();

  // Signed in, opening it shows the button, and still changes nothing.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "メールアドレスの確認", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "メールアドレスを確認する" })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toBeVisible();

  // The link still works, and the button confirms.
  await confirmEmailLink(page, link);
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toHaveCount(0);
});

test("keeps full-width characters and surrounding spaces in the password as typed", async ({ page }) => {
  const email = newEmail();
  const password = "\u3000ｔｗｅｌｖｅ\u3000ｃｈａｒｓ ";
  await signUp(page, email, "ふわふわ", password);
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Nothing was trimmed: the trimmed input is a different password.
  await logIn(page, email, password.trim());
  await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");

  await logIn(page, email, password);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator(".id-profile").getByText("ふわふわ")).toBeVisible();
});

test("signing up with a registered email shows the same screen", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  const before = (await readMails()).length;

  await signUp(page, email, "別の名前", "another password!");
  const mail = await lastMailTo(email, "alreadyRegistered", { after: before });
  expect(mail.link).toBe("http://localhost:3000/forgot");
});

test("shows form errors and keeps the entered values", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("メールアドレス", { exact: true }).fill(newEmail());
  await page.getByLabel("表示名").fill("ふわふわ");
  await page.getByLabel("パスワード", { exact: true }).fill("short");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("12");
  await expect(page.getByLabel("表示名")).toHaveValue("ふわふわ");
  await expect(page.getByLabel("パスワード", { exact: true })).toHaveValue("");
});

test("rejects a wrong password with one message", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);

  // An unknown address gets the same message as a wrong password.
  await logIn(page, newEmail(), "wrong password!!");
  await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await logIn(page, email, "wrong password!!");
    await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");
    await expect(page.getByLabel("メールアドレス", { exact: true })).toHaveValue(email);
  }
});

test("throttles logins of one address after 5 wrong passwords", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await logIn(page, email, "wrong password!!");
    // Wait for the answer: opening the login page again before it arrives cancels the request, and a cancelled
    // sign-in is not counted.
    await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");
  }
  await logIn(page, email);
  await expect(page.locator("form [role=alert]")).toHaveText("試行回数が多すぎます。しばらくしてからお試しください。");
  await expect(page).toHaveURL(/\/login$/);
});

test("a login hashes the password again when it was stored with the earlier parameters", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  // A row as it was written before the cost was raised (N=2^14, r=8, p=1).
  const salt = randomBytes(16);
  const key = scryptSync(PASSWORD.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 });
  const earlier = ["scrypt", 16384, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
  expect(await setPasswordHash(email, earlier)).toBe(1);

  await logIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  expect(await passwordHashOf(email)).toMatch(/^scrypt\$65536\$8\$2\$/);

  // The new hash is of the same password.
  await page.getByRole("button", { name: "ログアウト" }).click();
  // Opening /login before the logout has finished would redirect away from it.
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
});

test("an account refuses logins after 30 attempts from anywhere, until its password is reset", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  // One address is stopped after 5 attempts; this is the count over every address in the window.
  await setThrottle(`login:mail:${email}`, 29);
  await logIn(page, email, "wrong password!!");
  await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");
  await logIn(page, email);
  await expect(page.locator("form [role=alert]")).toHaveText("試行回数が多すぎます。しばらくしてからお試しください。");

  // Whoever holds the mailbox is not locked out: a reset clears the count.
  await requestReset(page, email);
  await setNewPassword(page, (await lastMailTo(email, "resetPassword")).link, "a brand new password");
  await expect(page).toHaveURL(/\/login\?reset=done$/);
  await logIn(page, email, "a brand new password");
  await expect(page).toHaveURL(/\/account$/);
});

test("unverified users see the resend notice", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  // The sign-up mail is in the log before the mails are counted below.
  await lastMailTo(email, "verify");

  await logIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const before = (await readMails()).length;
  await page.getByRole("button", { name: "確認メールを再送" }).click();
  await expect(page.getByRole("status")).toHaveText("確認メールを再送しました。");

  // A new mail, found by its place in the log: its link is the same as the first one's when both were made within
  // the same second (the token carries the time in seconds).
  const resent = await lastMailTo(email, "verify", { after: before });
  await confirmEmailLink(page, resent.link);
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toHaveCount(0);
});

test("login returns to next", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);

  await logIn(page, email, PASSWORD, "/login?next=%2Faccount%3Fx%3D1%26y%3D2");
  await expect(page).toHaveURL(/\/account\?x=1&y=2$/);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await logIn(page, email, PASSWORD, "/login?next=%2F%2Fevil.example");
  await expect(page).toHaveURL(/localhost:3000\/account$/);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await logIn(page, email, PASSWORD, "/login?next=https%3A%2F%2Fevil.example%2F");
  await expect(page).toHaveURL(/localhost:3000\/account$/);
});

test("serves the pages in Chinese with a locale-aware mail link", async ({ page }) => {
  const email = newEmail();
  await page.goto("/zh-tw/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="displayName"]').fill("蓬鬆");
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  const { link } = await lastMailTo(email, "verify");
  expect(link).toMatch(/^http:\/\/localhost:3000\/zh-tw\/verify\?token=/);
  expect((await lastMailTo(email, "verify")).subject).toContain("確認");
});

async function signUpVerifiedAndLogIn(page: Page, email: string, displayName = "ふわふわ") {
  await signUp(page, email, displayName);
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
}

const emailForm = (page: Page) =>
  page.locator("form").filter({ has: page.getByRole("button", { name: "メールアドレスを変更" }) });
const passwordForm = (page: Page) =>
  page.locator("form").filter({ has: page.getByRole("button", { name: "パスワードを変更" }) });

async function requestEmailChange(page: Page, email: string) {
  const form = emailForm(page);
  await form.getByLabel("新しいメールアドレス").fill(email);
  await form.getByLabel("今のパスワード").fill(PASSWORD);
  await form.getByRole("button", { name: "メールアドレスを変更" }).click();
  await expect(form.getByRole("status")).toContainText(email);
}

async function changePassword(page: Page, current: string, next: string) {
  const form = passwordForm(page);
  await form.getByLabel("今のパスワード").fill(current);
  await form.getByLabel("新しいパスワード").fill(next);
  await form.getByRole("button", { name: "パスワードを変更" }).click();
}

const profileValue = (page: Page, term: string) =>
  page.locator(".id-profile div").filter({ has: page.getByRole("term").filter({ hasText: term }) }).getByRole("definition");

test("changes the display name", async ({ page }) => {
  await signUpVerifiedAndLogIn(page, newEmail());
  await expect(profileValue(page, "表示名")).toHaveText("ふわふわ");

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "表示名を変更" }) });
  await form.getByLabel("新しい表示名").fill("   ");
  await form.getByRole("button", { name: "表示名を変更" }).click();
  await expect(form.getByRole("alert")).toHaveText("表示名は1〜50文字で入力してください。");

  await form.getByLabel("新しい表示名").fill("  もこもこ ");
  await form.getByRole("button", { name: "表示名を変更" }).click();
  await expect(form.getByRole("status")).toHaveText("表示名を変更しました。");
  await expect(profileValue(page, "表示名")).toHaveText("もこもこ");
  await page.reload();
  await expect(profileValue(page, "表示名")).toHaveText("もこもこ");
});

test("changes the email after the new address is confirmed", async ({ page }) => {
  const oldEmail = newEmail();
  const nextEmail = newEmail();
  await signUpVerifiedAndLogIn(page, oldEmail);

  const form = emailForm(page);
  await form.getByLabel("新しいメールアドレス").fill(` ${oldEmail.toUpperCase()} `);
  await form.getByLabel("今のパスワード").fill(PASSWORD);
  await form.getByRole("button", { name: "メールアドレスを変更" }).click();
  await expect(form.getByRole("alert")).toHaveText("今のメールアドレスと同じです。");

  // A wrong current password stops the request before any mail is sent.
  await form.getByLabel("新しいメールアドレス").fill(nextEmail);
  await form.getByLabel("今のパスワード").fill("wrong password!!");
  await form.getByRole("button", { name: "メールアドレスを変更" }).click();
  await expect(form.getByRole("alert")).toHaveText("今のパスワードが正しくありません。");
  await expect(form.getByLabel("新しいメールアドレス")).toHaveValue(nextEmail);
  await expect(form.getByLabel("今のパスワード")).toHaveValue("");
  expect((await readMails()).filter((mail) => mail.to === nextEmail)).toHaveLength(0);

  await requestEmailChange(page, nextEmail);
  await expect(form.getByRole("status")).toContainText(nextEmail);
  await page.reload();
  await expect(profileValue(page, "メールアドレス")).toHaveText(oldEmail);

  // The current address is told about the request, with the way to stop it: a password reset cancels it.
  const notice = await lastMailTo(oldEmail, "emailChangeRequested");
  expect(notice.link).toBe("http://localhost:3000/forgot");
  expect(notice.text).not.toContain(nextEmail);

  const { link } = await lastMailTo(nextEmail, "changeEmail");
  expect(link).toMatch(/^http:\/\/localhost:3000\/verify\?token=[\w-]+\.[\w-]+\.[\w-]+$/);
  await confirmEmailLink(page, link);
  await expect(page.getByRole("heading", { name: "メールアドレスを変更しました" })).toBeVisible();
  await page.goto("/account");
  await expect(profileValue(page, "メールアドレス")).toHaveText(nextEmail);
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toHaveCount(0);

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, oldEmail);
  await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");
  await logIn(page, nextEmail);
  await expect(page).toHaveURL(/\/account$/);
});

test("opening the email change link does not change the address until the button is pressed", async ({ page, request }) => {
  const email = newEmail();
  const nextEmail = newEmail();
  await signUpVerifiedAndLogIn(page, email);
  await requestEmailChange(page, nextEmail);
  const { link } = await lastMailTo(nextEmail, "changeEmail");

  expect((await request.get(link)).status()).toBeLessThan(500);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "メールアドレスの変更", exact: true })).toBeVisible();
  await page.goto("/account");
  await expect(profileValue(page, "メールアドレス")).toHaveText(email);

  await confirmEmailLink(page, link);
  await expect(page.getByRole("heading", { name: "メールアドレスを変更しました" })).toBeVisible();
  await page.goto("/account");
  await expect(profileValue(page, "メールアドレス")).toHaveText(nextEmail);
});

test("a verify link cannot be confirmed by another account", async ({ page }) => {
  // Someone signs up with an address that is not theirs; its owner must not confirm it for them.
  const victim = newEmail();
  await signUp(page, victim, "なりすまし");
  const { link } = await lastMailTo(victim, "verify");

  await signUpVerifiedAndLogIn(page, newEmail());
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "別のSparklingstadt IDあてのリンクです" })).toBeVisible();
  await expect(page.getByRole("button", { name: CONFIRM_BUTTON })).toHaveCount(0);

  // The link was not used up: the account it was sent for can still confirm it.
  await page.goto("/account");
  await page.getByRole("button", { name: "ログアウト" }).click();
  // Opening the link before the logout has finished would cancel it.
  await expect(page).toHaveURL(/\/login$/);
  await confirmEmailLink(page, link, { email: victim, password: PASSWORD });
  await expect(page.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
});

test("a new email change request expires the earlier link", async ({ page }) => {
  const email = newEmail();
  const mistyped = newEmail();
  const intended = newEmail();
  await signUpVerifiedAndLogIn(page, email);

  await page.goto("/account");
  await requestEmailChange(page, mistyped);
  const stale = await lastMailTo(mistyped, "changeEmail");
  await page.goto("/account");
  await requestEmailChange(page, intended);

  await page.goto(stale.link);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();
  await confirmEmailLink(page, (await lastMailTo(intended, "changeEmail")).link);
  await expect(page.getByRole("heading", { name: "メールアドレスを変更しました" })).toBeVisible();
  await page.goto("/account");
  await expect(profileValue(page, "メールアドレス")).toHaveText(intended);
});

test("an email change to an address taken meanwhile shows that it cannot be used", async ({ page, browser }) => {
  const email = newEmail();
  const contested = newEmail();
  await signUpVerifiedAndLogIn(page, email);

  await requestEmailChange(page, contested);
  const change = await lastMailTo(contested, "changeEmail");

  // Someone else registers and confirms the same address before the link is opened.
  const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": testIp() } });
  const otherPage = await other.newPage();
  await signUp(otherPage, contested, "べつのひと");
  await confirmEmailLink(otherPage, (await lastMailTo(contested, "verify")).link, {
    email: contested,
    password: PASSWORD,
  });
  await expect(otherPage.getByRole("heading", { name: "メールアドレスを確認しました" })).toBeVisible();
  await other.close();

  const response = await page.goto(change.link);
  expect(response?.status()).toBeLessThan(500);
  await page.getByRole("button", { name: "メールアドレスを変更する" }).click();
  await expect(page.getByRole("heading", { name: "このメールアドレスは使えません" })).toBeVisible();
  await page.goto("/account");
  await expect(profileValue(page, "メールアドレス")).toHaveText(email);
});

test("an email change signs out the other sessions and keeps this one", async ({ page, browser }) => {
  const email = newEmail();
  const nextEmail = newEmail();
  await signUpVerifiedAndLogIn(page, email);

  const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": testIp() } });
  const otherPage = await other.newPage();
  await logIn(otherPage, email);
  await expect(otherPage).toHaveURL(/\/account$/);

  await requestEmailChange(page, nextEmail);
  await confirmEmailLink(page, (await lastMailTo(nextEmail, "changeEmail")).link);
  await expect(page.getByRole("heading", { name: "メールアドレスを変更しました" })).toBeVisible();

  await otherPage.goto("/account");
  await expect(otherPage).toHaveURL(/\/login\?next=%2Faccount$/);
  await other.close();

  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  await expect(profileValue(page, "メールアドレス")).toHaveText(nextEmail);
});

test("changes the password and signs out the other sessions", async ({ page, browser }) => {
  const email = newEmail();
  await signUpVerifiedAndLogIn(page, email);

  const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": testIp() } });
  const otherPage = await other.newPage();
  await logIn(otherPage, email);
  await expect(otherPage).toHaveURL(/\/account$/);

  const form = passwordForm(page);
  await form.getByLabel("今のパスワード").fill("wrong password!!");
  await form.getByLabel("新しいパスワード").fill("a brand new password");
  await form.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(form.getByRole("alert")).toHaveText("今のパスワードが正しくありません。");
  await expect(form.getByLabel("今のパスワード")).toHaveValue("");

  await form.getByLabel("今のパスワード").fill(PASSWORD);
  await form.getByLabel("新しいパスワード").fill("short");
  await form.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(form.getByRole("alert")).toHaveText("パスワードは12〜128文字で入力してください。");

  await form.getByLabel("今のパスワード").fill(PASSWORD);
  await form.getByLabel("新しいパスワード").fill("a brand new password");
  await form.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(form.getByRole("status")).toHaveText("パスワードを変更しました。ほかの端末ではログアウトしました。");

  await otherPage.goto("/account");
  await expect(otherPage).toHaveURL(/\/login\?next=%2Faccount$/);
  await other.close();

  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, email);
  await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");
  await logIn(page, email, "a brand new password");
  await expect(page).toHaveURL(/\/account$/);
});

test("a password change cancels a pending email change", async ({ page }) => {
  const email = newEmail();
  const nextEmail = newEmail();
  await signUpVerifiedAndLogIn(page, email);
  await requestEmailChange(page, nextEmail);
  const { link } = await lastMailTo(nextEmail, "changeEmail");

  await changePassword(page, PASSWORD, "a brand new password");
  await expect(passwordForm(page).getByRole("status")).toHaveText("パスワードを変更しました。ほかの端末ではログアウトしました。");

  const response = await page.goto(link);
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();
  await page.goto("/account");
  await expect(profileValue(page, "メールアドレス")).toHaveText(email);
});

test("throttles wrong current passwords across both forms", async ({ page }) => {
  const email = newEmail();
  await signUpVerifiedAndLogIn(page, email);

  // A success resets the counter.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await changePassword(page, "wrong password!!", "a brand new password");
    await expect(passwordForm(page).getByRole("alert")).toHaveText("今のパスワードが正しくありません。");
  }
  await requestEmailChange(page, newEmail());

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await changePassword(page, "wrong password!!", "a brand new password");
    await expect(passwordForm(page).getByRole("alert")).toHaveText("今のパスワードが正しくありません。");
  }
  await changePassword(page, PASSWORD, "a brand new password");
  await expect(passwordForm(page).getByRole("alert")).toHaveText("試行回数が多すぎます。しばらくしてからお試しください。");

  const form = emailForm(page);
  await form.getByLabel("新しいメールアドレス").fill(newEmail());
  await form.getByLabel("今のパスワード").fill(PASSWORD);
  await form.getByRole("button", { name: "メールアドレスを変更" }).click();
  await expect(form.getByRole("alert")).toHaveText("試行回数が多すぎます。しばらくしてからお試しください。");

  // The password was not changed while throttled.
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await logIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
});

async function requestReset(page: Page, email: string) {
  await page.goto("/forgot");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByRole("button", { name: "再設定メールを送る" }).click();
  await expect(page.getByRole("heading", { name: "メールを送りました" })).toBeVisible();
}

async function setNewPassword(page: Page, link: string, password: string) {
  await page.goto(link);
  await page.getByLabel("新しいパスワード").fill(password);
  await page.getByRole("button", { name: "パスワードを設定" }).click();
}

test("resets the password from the mailed link", async ({ page }) => {
  const email = newEmail();
  await signUpVerifiedAndLogIn(page, email);

  // An unknown address gets the same screen, and no mail.
  const unknown = newEmail();
  const before = (await readMails()).length;
  await requestReset(page, unknown);

  await page.goto("/forgot");
  await page.getByLabel("メールアドレス", { exact: true }).fill(` ${email.toUpperCase()} `);
  await page.getByRole("button", { name: "再設定メールを送る" }).click();
  await expect(page.getByRole("heading", { name: "メールを送りました" })).toBeVisible();
  const { link } = await lastMailTo(email, "resetPassword", { after: before });
  expect(link).toMatch(/^http:\/\/localhost:3000\/reset\?token=[\w-]{24}$/);
  expect((await readMails()).filter((mail) => mail.to === unknown)).toHaveLength(0);

  await setNewPassword(page, link, "short");
  await expect(page.locator("form [role=alert]")).toHaveText("パスワードは12〜128文字で入力してください。");

  await setNewPassword(page, link, "a brand new password");
  await expect(page).toHaveURL(/\/login\?reset=done$/);
  await expect(page.getByRole("status")).toHaveText("パスワードを再設定しました。新しいパスワードでログインしてください。追加していたパスキーは削除しました。使う場合はもう一度追加してください。");

  // The session from before the reset is gone.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);

  const again = await page.goto(link);
  expect(again?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();

  await logIn(page, email);
  await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");
  await logIn(page, email, "a brand new password");
  await expect(page).toHaveURL(/\/account$/);
});

test("the login page links to the password reset", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "パスワードを忘れた場合" }).click();
  await expect(page).toHaveURL(/\/forgot$/);
  await page.goto("/zh-cn/login");
  await page.locator('a[href="/zh-cn/forgot"]').click();
  await expect(page).toHaveURL(/\/zh-cn\/forgot$/);
});

test("an unverified account that resets its password becomes verified", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await logIn(page, email);
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toBeVisible();

  await requestReset(page, email);
  await setNewPassword(page, (await lastMailTo(email, "resetPassword")).link, "a brand new password");
  await expect(page).toHaveURL(/\/login\?reset=done$/);

  await logIn(page, email, "a brand new password");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toHaveCount(0);
});

test("the header shows the name, the language switch and the signed-in display name", async ({ page }) => {
  await page.goto("/login");
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Sparklingstadt ID" })).toHaveAttribute("href", "/account");
  await expect(header.locator(".language-switcher a[aria-current=page]")).toHaveText("日本語");
  await expect(header.locator(".language-switcher a[hrefLang=zh-CN]")).toHaveAttribute("href", "/zh-cn/login");
  await expect(header.locator(".header-user")).toHaveCount(0);

  const email = newEmail();
  await signUpVerifiedAndLogIn(page, email, "ふわふわ");
  await expect(header.locator(".header-user")).toHaveText("ふわふわ");

  await page.goto("/zh-cn/account");
  await expect(header.locator(".header-user")).toHaveText("ふわふわ");
});

test("the root redirects to the account page, and a signed-out visitor on to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/localhost:3000\/login\?next=%2Faccount$/);
});

test("/zh-cn/login renders in Simplified Chinese", async ({ page }) => {
  await page.goto("/zh-cn/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "使用 Sparklingstadt ID 登录" })).toBeVisible();
});

test("the zh-cn and zh-tw ID pages render in Chinese", async ({ page }) => {
  await page.goto("/zh-cn/signup");
  await expect(page.getByRole("heading", { name: "创建 Sparklingstadt ID" })).toBeVisible();
  await page.goto("/zh-tw/login");
  await expect(page.getByRole("heading", { name: "使用 Sparklingstadt ID 登入" })).toBeVisible();
});

test("a verify link past its 24 hours is refused, on the button and on a later visit", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  const { link } = await lastMailTo(email, "verify");

  // Open the link while it is still good (logging in on the way), then let it run out before pressing the button.
  await page.goto(link);
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const button = page.getByRole("button", { name: CONFIRM_BUTTON });
  await expect(button).toBeVisible();
  // The token is a signed message with its expiry inside, so the clock cannot be moved in a row: the form carries a copy that has run out.
  const expired = expiredCopyOfLink(link);
  await page.locator('input[name="token"]').evaluate((input, token) => ((input as HTMLInputElement).value = token), new URL(expired).searchParams.get("token") ?? "");
  await button.click();
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();

  // Opening it again offers no button.
  await page.goto(expired);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();
  await expect(page.getByRole("button", { name: CONFIRM_BUTTON })).toHaveCount(0);

  // The address is still unconfirmed.
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "確認メールを再送" })).toBeVisible();
});

test("a reset link past its hour is refused and leaves the password as it was", async ({ page }) => {
  const email = newEmail();
  await signUpVerifiedAndLogIn(page, email);
  await page.context().clearCookies();
  const before = (await readMails()).length;
  await requestReset(page, email);
  const { link } = await lastMailTo(email, "resetPassword", { after: before });

  // Open the form while the link is still good, then let it run out before submitting.
  await page.goto(link);
  await page.getByLabel("新しいパスワード").fill("a brand new password");
  expect(await expireMailedLink(link)).toBe(1);
  await page.getByRole("button", { name: "パスワードを設定" }).click();
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();

  // Opening it again shows no form.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();
  await expect(page.getByLabel("新しいパスワード")).toHaveCount(0);

  await logIn(page, email, "a brand new password");
  await expect(page.locator("form [role=alert]")).toHaveText("メールアドレスまたはパスワードが正しくありません。");
  await logIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
});

test("a reset link mailed before an email change is refused after the move", async ({ page }) => {
  const email = newEmail();
  const nextEmail = newEmail();
  await signUpVerifiedAndLogIn(page, email);

  const before = (await readMails()).length;
  const other = await page.context().browser()!.newContext({ extraHTTPHeaders: { "x-forwarded-for": testIp() } });
  const otherPage = await other.newPage();
  await requestReset(otherPage, email);
  const reset = await lastMailTo(email, "resetPassword", { after: before });
  await other.close();

  await requestEmailChange(page, nextEmail);
  await confirmEmailLink(page, (await lastMailTo(nextEmail, "changeEmail")).link);
  await expect(page.getByRole("heading", { name: "メールアドレスを変更しました" })).toBeVisible();

  await page.goto(reset.link);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();
  await expect(page.getByLabel("新しいパスワード")).toHaveCount(0);
});

test("an email change link is refused after the move and for another account", async ({ page, browser }) => {
  const email = newEmail();
  const nextEmail = newEmail();
  await signUpVerifiedAndLogIn(page, email);
  await requestEmailChange(page, nextEmail);
  const { link } = await lastMailTo(nextEmail, "changeEmail");

  // Another signed-in account cannot use it, and that leaves it usable.
  const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": testIp() } });
  const otherPage = await other.newPage();
  await signUpVerifiedAndLogIn(otherPage, newEmail());
  await otherPage.goto(link);
  await expect(otherPage.getByRole("heading", { name: "別のSparklingstadt IDあてのリンクです" })).toBeVisible();
  await expect(otherPage.getByRole("button", { name: CONFIRM_BUTTON })).toHaveCount(0);
  await other.close();

  await confirmEmailLink(page, link);
  await expect(page.getByRole("heading", { name: "メールアドレスを変更しました" })).toBeVisible();

  // The address has moved: the same link means nothing now.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "リンクが無効か期限切れです" })).toBeVisible();
  await expect(page.getByRole("button", { name: CONFIRM_BUTTON })).toHaveCount(0);
});
