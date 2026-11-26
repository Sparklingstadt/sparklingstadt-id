import { randomUUID } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { authOptionsFrom } from "./auth-options.ts";
import { purposeOf, readToken, type EmailLinkPurpose, type Payload } from "./link-token.ts";
import { hashToken } from "./tokens.ts";

const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const changeKey = (userId: string) => `change-email:${userId}`;


/** The account a mailed link is for and what it would do, or null for a link that is "invalid" (unknown, expired, used or stale). */
export async function peekEmailLink(
  token: string,
): Promise<{ purpose: EmailLinkPurpose; userId: string; email: string; updateTo?: string } | null> {
  const payload = readToken(token, authOptionsFrom(process.env).secret);
  if (!payload || typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
  const user = await getPrisma().user.findUnique({
    where: { id: payload.userId },
    select: { email: true, emailVerified: true },
  });
  // The address changed after the mail was sent: the link no longer proves anything.
  if (!user || user.email.toLowerCase() !== payload.email.toLowerCase()) return null;

  const purpose = purposeOf(payload);
  if (purpose === null) return null;
  if (purpose === "verify") {
    // A confirmed address has nothing left to confirm (the token is a signed message, not a row, so "used" is read from the account).
    if (user.emailVerified) return null;
    return { purpose: "verify", userId: payload.userId, email: payload.email };
  }
  if (typeof payload.updateTo !== "string") return null;
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
