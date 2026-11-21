import { timingSafeEqual } from "node:crypto";
import type { User } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { s256 } from "./pkce.ts";
import { hashToken, newToken } from "./tokens.ts";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

/** Stores a single-use authorization code (only its SHA-256) and returns the code itself. */
export async function issueAuthCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce?: string;
  authTime: Date;
}): Promise<string> {
  const code = newToken();
  await getPrisma().authCode.create({
    data: {
      codeHash: hashToken(code),
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      nonce: input.nonce,
      authTime: input.authTime,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Redeems an authorization code exactly once. The code is marked used by a single
 * conditional UPDATE, so of two concurrent redemptions only one gets the row back.
 * A code that does not match the client, redirect URI or PKCE verifier is still spent.
 */
export async function redeemAuthCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ user: User; nonce: string | null; authTime: Date } | { error: "invalid_grant" }> {
  const prisma = getPrisma();
  // Prisma stores DateTime as UTC in timestamp(3) columns, so compare against UTC.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE auth_codes SET used_at = now() AT TIME ZONE 'UTC'
    WHERE code_hash = ${hashToken(input.code)}
      AND used_at IS NULL
      AND expires_at > now() AT TIME ZONE 'UTC'
    RETURNING id`;
  if (rows.length !== 1) return { error: "invalid_grant" };
  // The row is ours now; read it back through Prisma for typed values.
  const row = await prisma.authCode.findUnique({ where: { id: rows[0].id }, include: { user: true } });
  if (
    !row ||
    row.clientId !== input.clientId ||
    row.redirectUri !== input.redirectUri ||
    !sameString(s256(input.codeVerifier), row.codeChallenge) ||
    !row.user.emailVerifiedAt
  ) {
    return { error: "invalid_grant" };
  }
  return { user: row.user, nonce: row.nonce, authTime: row.authTime };
}

/** Redirects to the client's registered `redirectUri` with an OAuth error (RFC 6749 §4.1.2.1). */
export function authorizeError(redirectUri: string, error: string, state: string | null): Response {
  return redirectToClient(redirectUri, { error, state });
}

/** Redirects to the client's registered `redirectUri`, adding the given query parameters. */
export function redirectToClient(redirectUri: string, params: Record<string, string | null>): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}
