import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { hashPassword } from "../lib/password.ts";
import { generateSigningJwk } from "./helpers/signing-key";
import { testIp } from "./helpers/account";

const ISSUER = "http://localhost:3000";
const PASSWORD = "  twelve chars  ";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/sparklingstadt_id";

// The `users` table as the first release (e471d93) created it. The drop migration removed it, so this test makes it
// itself when it is missing, and removes it again afterwards.
const LEGACY_USERS = `
  create table if not exists "users" (
    "id" text not null,
    "email" text not null,
    "display_name" text not null,
    "password_hash" text not null,
    "email_verified_at" timestamp(3),
    "session_version" integer not null default 0,
    "created_at" timestamp(3) not null default current_timestamp,
    "updated_at" timestamp(3) not null,
    constraint "users_pkey" primary key ("id")
  );
  create unique index if not exists "users_email_key" on "users"("email");`;

async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

type Result = { users: number; clients: number; key: "imported" | "skipped" };

function runImport(signingKey: string): Result {
  const out = execFileSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/import-legacy.ts"],
    { env: { ...process.env, OIDC_SIGNING_KEY: signingKey }, encoding: "utf8" },
  );
  return JSON.parse(out.trim().split("\n").pop() as string);
}

test("a legacy user keeps id and password after import", async ({ page, request }) => {
  const id = `legacy${randomBytes(8).toString("hex")}`;
  const email = `legacy-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const signingKey = generateSigningJwk();
  const kid: string = JSON.parse(signingKey).kid;
  const hadTable = ((await sql(`select to_regclass('public.users') as t`)).rows[0].t as string | null) !== null;

  try {
    await sql(LEGACY_USERS);
    await sql(
      `insert into "users" (id, email, display_name, password_hash, email_verified_at, updated_at)
       values ($1, $2, $3, $4, now(), now())`,
      [id, email, "もとのなまえ", await hashPassword(PASSWORD)],
    );

    const first = runImport(signingKey);
    // A development database may hold other old rows (they are imported too, and removed again below).
    expect(first.users).toBeGreaterThanOrEqual(1);
    expect(first.key).toBe("imported");
    const migrated = (await sql("select id, name, email_verified from ba_users where email = $1", [email])).rows[0];
    expect(migrated).toEqual({ id, name: "もとのなまえ", email_verified: true });

    // The password hash moved unchanged, so the same password signs in.
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": testIp() });
    await page.goto("/login");
    await page.getByLabel("メールアドレス", { exact: true }).fill(email);
    await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);

    // The ID token's sub is the old users.id, and it is signed with the imported key (same kid).
    const verifier = randomBytes(32).toString("base64url");
    const authorize = await page.request.get(
      `/oauth/authorize?${new URLSearchParams({
        client_id: "e2e-client",
        redirect_uri: `${ISSUER}/e2e-callback`,
        response_type: "code",
        scope: "openid email profile",
        state: "s",
        nonce: "n",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      })}`,
      { maxRedirects: 0 },
    );
    const code = new URL(authorize.headers()["location"]).searchParams.get("code") as string;
    const token = await request.post("/oauth/token", {
      headers: { Authorization: `Basic ${Buffer.from("e2e-client:e2e-secret").toString("base64")}` },
      form: { grant_type: "authorization_code", code, redirect_uri: `${ISSUER}/e2e-callback`, code_verifier: verifier },
    });
    expect(token.status()).toBe(200);
    const [header, payload] = (await token.json()).id_token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString()).kid).toBe(kid);
    expect(JSON.parse(Buffer.from(payload, "base64url").toString()).sub).toBe(id);

    // Running it again changes nothing.
    expect(runImport(signingKey)).toMatchObject({ users: 0, key: "skipped" });
    expect((await sql("select count(*)::int as n from ba_users where email = $1", [email])).rows[0].n).toBe(1);
    expect((await sql("select count(*)::int as n from ba_accounts where user_id = $1", [id])).rows[0].n).toBe(1);
  } finally {
    await sql(`delete from ba_users where email = $1 or id in (select id from "users")`, [email]);
    await sql("delete from ba_jwks where id = $1", [kid]);
    if (hadTable) await sql(`delete from "users" where id = $1`, [id]);
    else await sql(`drop table if exists "users"`);
  }
});

test("importing without a legacy users table reports zero users", async () => {
  const hadTable = ((await sql(`select to_regclass('public.users') as t`)).rows[0].t as string | null) !== null;
  test.skip(hadTable, "the legacy table still exists in this database");
  expect(runImport("")).toMatchObject({ users: 0, key: "skipped" });
});
