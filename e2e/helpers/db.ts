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

/** Puts an authorization code past its 5 minutes. Returns the number of rows changed (1 when found). */
export function expireAuthCode(code: string): Promise<number> {
  return run(`update auth_codes set expires_at = ${ONE_SECOND_AGO} where code_hash = $1`, [hashToken(code)]);
}

/** Puts the token of a mailed link (`…?token=…`) past its lifetime. Returns the number of rows changed. */
export function expireMailedLink(link: string): Promise<number> {
  const token = new URL(link).searchParams.get("token") ?? "";
  return run(`update email_tokens set expires_at = ${ONE_SECOND_AGO} where token_hash = $1`, [hashToken(token)]);
}

/** Deletes an account (its sessions, codes and mail tokens cascade). Returns the number of rows deleted. */
export function deleteUser(email: string): Promise<number> {
  return run("delete from users where email = $1", [email]);
}

/** The stored password hash of an account. */
export async function passwordHashOf(email: string): Promise<string> {
  return (await query("select password_hash from users where email = $1", [email])).rows[0].password_hash;
}

/** Replaces the stored password hash of an account. Returns the number of rows changed (1 when found). */
export function setPasswordHash(email: string, hash: string): Promise<number> {
  return run("update users set password_hash = $2 where email = $1", [email, hash]);
}

/** Sets a throttle counter as if `count` attempts had just been made in a window that starts now. */
export function setThrottle(key: string, count: number): Promise<number> {
  return run(
    `insert into throttles ("key", count, window_start) values ($1, $2, now())
     on conflict ("key") do update set count = excluded.count, window_start = excluded.window_start`,
    [key, count],
  );
}
