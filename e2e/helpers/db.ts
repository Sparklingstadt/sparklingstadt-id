import { Client } from "pg";
import { hashToken } from "../../lib/id/tokens";

// Tests cannot wait out a lifetime, so they move the clock in the row instead. Each call opens its own
// connection: the spec files share one worker, so a shared pool would be closed under the next file.
async function run(sql: string, values: unknown[]): Promise<number> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/sparklingstadt_id",
  });
  await client.connect();
  try {
    return (await client.query(sql, values)).rowCount ?? 0;
  } finally {
    await client.end();
  }
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
