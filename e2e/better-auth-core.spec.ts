import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

const PASSWORD = "  twelve chars  ";
// Better Auth checks the Origin of a request that carries cookies or follows a sign-in; a browser always sends it.
const headers = { origin: "http://localhost:3000" };

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

test("sign-up and sign-in through /api/auth work with the legacy password hash", async ({ request }) => {
  const email = `ba-core-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;

  const signUp = await request.post("/api/auth/sign-up/email", {
    data: { email, password: PASSWORD, name: "べったーおーす" },
    headers,
  });
  expect(signUp.status()).toBe(200);

  expect(await accountPassword(email)).toMatch(/^scrypt\$/);

  const signIn = await request.post("/api/auth/sign-in/email", { data: { email, password: PASSWORD }, headers });
  expect(signIn.status(), await signIn.text()).toBe(200);
  expect(signIn.headers()["set-cookie"]).toMatch(/better-auth\.session_token=/);
});
