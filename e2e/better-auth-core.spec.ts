import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { testIp } from "./helpers/account";
import { deleteUser } from "./helpers/db";

const PASSWORD = "  twelve chars  ";
// Better Auth checks the Origin of a request that carries cookies or follows a sign-in; a browser always sends it.
const headers = { origin: "http://localhost:3000" };

// Its own client IP, so the per-IP throttles never trip across the suite.
test.use({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": testIp() });
  },
});

async function accountPassword(email: string): Promise<string> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/sparklingstadt_id",
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select a.password from ba_accounts a join ba_users u on u.id = a.user_id where u.email = $1",
      [email],
    );
    return rows[0].password;
  } finally {
    await client.end();
  }
}

test("an account made on the sign-up page signs in through /api/auth with the legacy password hash", async ({ page, request }) => {
  const email = `ba-core-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  try {
    await signUpAndIn(page, request, email);
  } finally {
    // The test makes its own account and removes it (its sessions and password cascade).
    await deleteUser(email);
  }
});

async function signUpAndIn(page: Page, request: APIRequestContext, email: string) {
  // Signing up goes through the page's server action (/api/auth/sign-up/email answers 404 over HTTP:
  // lib/id/server-only-endpoints.ts, e2e/server-only.spec.ts).
  await page.goto("/signup");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("表示名").fill("べったーおーす");
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("確認メールを送りました")).toBeVisible();

  expect(await accountPassword(email)).toMatch(/^scrypt\$/);

  const signIn = await request.post("/api/auth/sign-in/email", { data: { email, password: PASSWORD }, headers });
  expect(signIn.status(), await signIn.text()).toBe(200);
  expect(signIn.headers()["set-cookie"]).toMatch(/better-auth\.session_token=/);
}

// The production checklist (README) calls this after a deploy: a missing BETTER_AUTH_SECRET only shows at the first request.
test("the health endpoint answers 200", async ({ request }) => {
  const response = await request.get("/api/auth/ok");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});
