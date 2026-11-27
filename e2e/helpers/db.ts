import { createHash } from "node:crypto";
import { Client } from "pg";
import { hashToken } from "../../lib/id/tokens";

// Tests cannot wait out a lifetime, so they move the clock in the row instead. Each call opens its own
// connection: the spec files share one worker, so a shared pool would be closed under the next file.
async function query(sql: string, values: unknown[]) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/sparklingstadt_id",
  });
  await client.connect();
  try {
    return await client.query(sql, values);
  } finally {
    await client.end();
  }
}

async function run(sql: string, values: unknown[]): Promise<number> {
  return (await query(sql, values)).rowCount ?? 0;
}

// Prisma stores DateTime as UTC in timestamp(3) columns.
const ONE_SECOND_AGO = "now() at time zone 'UTC' - interval '1 second'";

/** How the oauth-provider plugin stores codes and opaque tokens: SHA-256, base64url without padding. */
function storedToken(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Puts an authorization code past its 5 minutes. Returns the number of rows changed (1 when found). */
export function expireAuthCode(code: string): Promise<number> {
  return run(`update ba_verifications set expires_at = ${ONE_SECOND_AGO} where identifier = $1`, [storedToken(code)]);
}

/** Puts an opaque access token past its 5 minutes. Returns the number of rows changed (1 when found). */
export function expireAccessToken(token: string): Promise<number> {
  return run(`update ba_oauth_access_tokens set expires_at = ${ONE_SECOND_AGO} where token = $1`, [storedToken(token)]);
}

/** Whether a session row with this token still exists. */
export async function sessionExists(token: string): Promise<boolean> {
  return ((await query("select 1 from ba_sessions where token = $1", [token])).rowCount ?? 0) > 0;
}

/** Makes the session older than Better Auth's 24 hours of freshness (it lasts 30 days). Returns the rows changed. */
export function ageSession(token: string): Promise<number> {
  return run(
    `update ba_sessions set created_at = now() at time zone 'UTC' - interval '2 days',
     updated_at = now() at time zone 'UTC' - interval '2 days' where token = $1`,
    [token],
  );
}

/**
 * Puts the token of a mailed link (`…?token=…`) past its lifetime. Returns the number of rows changed.
 * Reset links and email change links are rows; a verify link is a signed token with its expiry inside
 * (see expiredCopyOfLink in verify.ts), so it changes nothing here.
 */
export function expireMailedLink(link: string): Promise<number> {
  const token = new URL(link).searchParams.get("token") ?? "";
  return run(
    `update ba_verifications set expires_at = ${ONE_SECOND_AGO}
     where identifier = $1 or (identifier like 'change-email:%' and value = $2)`,
    [`reset-password:${token}`, hashToken(token)],
  );
}

/** Deletes an account (its sessions and passwords cascade). Returns the number of rows deleted. */
export function deleteUser(email: string): Promise<number> {
  return run("delete from ba_users where email = $1", [email]);
}

/** The stored password hash of an account. */
export async function passwordHashOf(email: string): Promise<string> {
  return (
    await query(
      `select a.password from ba_accounts a join ba_users u on u.id = a.user_id
       where u.email = $1 and a.provider_id = 'credential'`,
      [email],
    )
  ).rows[0].password;
}

/** Replaces the stored password hash of an account. Returns the number of rows changed (1 when found). */
export function setPasswordHash(email: string, hash: string): Promise<number> {
  return run(
    `update ba_accounts set password = $2
     where provider_id = 'credential' and user_id = (select id from ba_users where email = $1)`,
    [email, hash],
  );
}

/** Sets a throttle counter as if `count` attempts had just been made in a window that starts now. */
export function setThrottle(key: string, count: number): Promise<number> {
  return run(
    `insert into throttles ("key", count, window_start) values ($1, $2, now())
     on conflict ("key") do update set count = excluded.count, window_start = excluded.window_start`,
    [key, count],
  );
}

/** The id of the account with this address, or undefined. */
export async function userIdOf(email: string): Promise<string | undefined> {
  return (await query("select id from ba_users where email = $1", [email])).rows[0]?.id;
}

/** The address stored for an account. */
export async function emailOf(userId: string): Promise<string | undefined> {
  return (await query("select email from ba_users where id = $1", [userId])).rows[0]?.email;
}

/** How many session rows an account has. */
export async function sessionCountOf(userId: string): Promise<number> {
  return (await query("select count(*)::int as n from ba_sessions where user_id = $1", [userId])).rows[0].n;
}

/** How many authorization codes the oauth-provider plugin has stored for an account. */
export async function authCodeCountOf(userId: string): Promise<number> {
  return (
    await query(
      `select count(*)::int as n from ba_verifications
       where value like '%"type":"authorization_code"%' and value like $1`,
      [`%"userId":"${userId}"%`],
    )
  ).rows[0].n;
}

/** How many passkeys an account has. */
export async function passkeyCountOf(email: string): Promise<number> {
  return (
    await query(
      "select count(*)::int as n from ba_passkeys where user_id = (select id from ba_users where email = $1)",
      [email],
    )
  ).rows[0].n;
}
