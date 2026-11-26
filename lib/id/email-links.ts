import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { authOptionsFrom } from "./auth-options.ts";
import { hashToken } from "./tokens.ts";

const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const changeKey = (userId: string) => `change-email:${userId}`;

export type EmailLinkPurpose = "verify" | "change_email";

type Payload = { email?: unknown; updateTo?: unknown; requestType?: unknown; userId?: unknown; exp?: unknown };

/**
 * Reads a token Better Auth mailed (an HS256 JWT) without using it. Null when the signature or the
 * lifetime is wrong. The page needs this to decide what to offer: only a POST may confirm.
 */
function readToken(token: string): Payload | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  try {
    if ((JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: unknown }).alg !== "HS256") return null;
    const expected = createHmac("sha256", authOptionsFrom(process.env).secret).update(`${header}.${body}`).digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The account a mailed link is for and what it would do, or null for a link that is "invalid" (unknown, expired, used or stale). */
export async function peekEmailLink(
  token: string,
): Promise<{ purpose: EmailLinkPurpose; userId: string; email: string; updateTo?: string } | null> {
  const payload = readToken(token);
  if (!payload || typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
  const user = await getPrisma().user.findUnique({
    where: { id: payload.userId },
    select: { email: true, emailVerified: true },
  });
  // The address changed after the mail was sent: the link no longer proves anything.
  if (!user || user.email.toLowerCase() !== payload.email.toLowerCase()) return null;

  if (payload.updateTo === undefined) {
    // A confirmed address has nothing left to confirm (the token is a signed message, not a row, so "used" is read from the account).
    if (payload.requestType !== undefined || user.emailVerified) return null;
    return { purpose: "verify", userId: payload.userId, email: payload.email };
  }
  if (payload.requestType !== "change-email-verification" || typeof payload.updateTo !== "string") return null;
  // Only the latest request stays valid.
  const latest = await getPrisma().verification.findFirst({
    where: { identifier: changeKey(payload.userId), value: hashToken(token), expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!latest) return null;
  return { purpose: "change_email", userId: payload.userId, email: payload.email, updateTo: payload.updateTo };
}

/** Makes `token` the only valid email change link of the user. */
export async function rememberChangeEmailLink(userId: string, token: string): Promise<void> {
  await forgetChangeEmailLink(userId);
  await getPrisma().verification.create({
    data: {
      id: randomUUID(),
      identifier: changeKey(userId),
      value: hashToken(token),
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    },
  });
}

/** Cancels the pending email change link of the user, if any. */
export async function forgetChangeEmailLink(userId: string): Promise<void> {
  await getPrisma().verification.deleteMany({ where: { identifier: changeKey(userId) } });
}

/** Cancels every pending email change and password reset link of the user (their password just changed). */
export async function cancelPendingLinks(userId: string): Promise<void> {
  await getPrisma().verification.deleteMany({
    where: { OR: [{ identifier: changeKey(userId) }, { identifier: { startsWith: "reset-password:" }, value: userId }] },
  });
}

/** The `requestType` of a token Better Auth just created for a mail (it signed it itself, so no check). */
export function requestTypeOf(token: string): string | undefined {
  try {
    const body = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as Payload;
    return typeof body.requestType === "string" ? body.requestType : undefined;
  } catch {
    return undefined;
  }
}
