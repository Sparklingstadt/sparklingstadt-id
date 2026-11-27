import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { cancelPendingLinks, forgetChangeEmailLink, peekEmailLink } from "./email-links.ts";
import type { EmailLinkPurpose } from "./link-token.ts";
import { sendEmailChangeRequested } from "./auth-mail.ts";
import { hashNonce, newGrantNonce, PASSKEY_GRANT_MINUTES, passkeyGrantIdentifier } from "./passkey-grant.ts";
import { checkPassword, normalizeDisplayName, normalizeEmail, ValidationError } from "./validation.ts";

/** The input rules stay ours (validation.ts); Better Auth does the account work, and its mail hooks are in auth-mail.ts. */

/** True for the Better Auth error with this `code` (e.g. INVALID_PASSWORD); other errors are not ours to interpret. */
function failedWith(error: unknown, ...codes: string[]): boolean {
  return isAPIError(error) && typeof error.body?.code === "string" && codes.includes(error.body.code);
}

/** True when a throttle of accountThrottle (lib/id/account-throttle.ts) stopped the request. */
export function isThrottled(error: unknown): boolean {
  return failedWith(error, "THROTTLED");
}

/** Throws ValidationError for bad input. Same result whether or not the address is taken (Better Auth mails the owner of a registered address). */
export async function signUp(input: { email: string; displayName: string; password: string }): Promise<void> {
  const email = normalizeEmail(input.email);
  const name = normalizeDisplayName(input.displayName);
  const password = checkPassword(input.password);
  await auth.api.signUpEmail({ body: { email, name, password }, headers: await headers() });
}

/** Sends a new verify link to the signed-in account's address. */
export async function resendVerification(email: string): Promise<"sent" | "alreadyVerified"> {
  try {
    await auth.api.sendVerificationEmail({ body: { email }, headers: await headers() });
  } catch (error) {
    if (failedWith(error, "EMAIL_ALREADY_VERIFIED")) return "alreadyVerified";
    throw error;
  }
  return "sent";
}

/** Throws ValidationError for a bad name. Returns the stored (trimmed) name. */
export async function changeDisplayName(value: string): Promise<string> {
  const name = normalizeDisplayName(value);
  await auth.api.updateUser({ body: { name }, headers: await headers() });
  return name;
}

/**
 * Mails a link to the NEW address; the account keeps the old one until it is opened. The CURRENT address is told
 * about the request (not where to), with the link to reset the password: a reset cancels the request and ends
 * every session, should someone else have asked. Same result whether or not the new address is taken (that is
 * only told when the link is opened). Throws ValidationError for a bad address, or code "sameEmail" for the current one.
 */
export async function requestEmailChange(
  user: { id: string; email: string },
  newEmail: string,
  currentPassword: string,
): Promise<"sent" | "wrongPassword"> {
  const email = normalizeEmail(newEmail);
  if (user.email.toLowerCase() === email) throw new ValidationError("email", "sameEmail");
  const requestHeaders = await headers();
  try {
    await auth.api.verifyPassword({ body: { password: currentPassword }, headers: requestHeaders });
  } catch (error) {
    if (failedWith(error, "INVALID_PASSWORD")) return "wrongPassword";
    throw error;
  }
  // Only the latest request stays valid: a link to a mistyped address must not work after a new one is asked for.
  await forgetChangeEmailLink(user.id);
  await auth.api.changeEmail({ body: { newEmail: email }, headers: requestHeaders });
  await sendEmailChangeRequested(user.email);
  return "sent";
}

/**
 * Checks the password of the signed-in account and records, for this session, the grant that lets one passkey be
 * added for 5 minutes (the hook in lib/id/passkey-grant.ts enforces it). The check counts toward the same
 * 5-per-15-minutes limit as the other password forms (accountThrottle, on /verify-password); a throttled request throws.
 */
export async function grantPasskeyAdd(sessionId: string, password: string): Promise<{ nonce: string } | "wrongPassword"> {
  try {
    await auth.api.verifyPassword({ body: { password }, headers: await headers() });
  } catch (error) {
    if (failedWith(error, "INVALID_PASSWORD")) return "wrongPassword";
    throw error;
  }
  const { internalAdapter } = await auth.$context;
  const identifier = passkeyGrantIdentifier(sessionId);
  // One grant per session: a new password entry replaces the last one.
  await internalAdapter.consumeVerificationValue(identifier);
  // The caller puts the nonce in a cookie; only its hash is stored (passkey-grant.ts).
  const nonce = newGrantNonce();
  await internalAdapter.createVerificationValue({
    identifier,
    value: hashNonce(nonce),
    expiresAt: new Date(Date.now() + PASSKEY_GRANT_MINUTES * 60 * 1000),
  });
  return { nonce };
}

/**
 * Throws ValidationError for a bad new password. On success every other session and every pending email change /
 * password reset link of the user is gone; Better Auth keeps this browser signed in with a new session.
 */
export async function changePassword(userId: string, current: string, next: string): Promise<"ok" | "wrongPassword"> {
  const newPassword = checkPassword(next);
  try {
    await auth.api.changePassword({
      body: { currentPassword: current, newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (error) {
    if (failedWith(error, "INVALID_PASSWORD")) return "wrongPassword";
    throw error;
  }
  // Links requested from a stolen session must not outlive it.
  await cancelPendingLinks(userId);
  return "ok";
}

/**
 * Mails a reset link when the address belongs to an account. The answer is the same either way (also for an
 * invalid address); Better Auth sends the mail after the response.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  let normalized: string;
  try {
    normalized = normalizeEmail(email);
  } catch (error) {
    if (error instanceof ValidationError) return;
    throw error;
  }
  try {
    await auth.api.requestPasswordReset({ body: { email: normalized }, headers: await headers() });
  } catch (error) {
    // Asking again and again is answered like any other request: nothing tells whether the address exists.
    if (!isThrottled(error)) throw error;
  }
}

/** Whether the reset page should offer the form (the action checks again). */
export async function isResetTokenUsable(token: string): Promise<boolean> {
  if (!token || token.length > 128) return false;
  const row = await getPrisma().verification.findFirst({
    where: { identifier: `reset-password:${token}`, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return row !== null;
}

export type ResetPasswordResult = { ok: true } | { ok: false; reason: "invalid" };

/**
 * Throws ValidationError for a bad password. Uses the link once; Better Auth sets the password and ends every
 * session, and onPasswordReset (lib/auth.ts) marks the address verified and cancels the other pending links.
 */
export async function resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
  const newPassword = checkPassword(password);
  if (!(await isResetTokenUsable(token))) return { ok: false, reason: "invalid" };
  try {
    await auth.api.resetPassword({ body: { newPassword, token }, headers: await headers() });
  } catch (error) {
    if (failedWith(error, "INVALID_TOKEN")) return { ok: false, reason: "invalid" };
    throw error;
  }
  return { ok: true };
}

/**
 * peekEmailLink has checked the signature, the lifetime, the account and that this is the latest request, so the
 * address is moved here rather than by Better Auth's verifyEmail: that one replaces the session cookie, which
 * redraws the verify page, and the page then shows the link it just used as invalid.
 */
async function confirmEmailChange(
  link: { userId: string; updateTo?: string },
  sessionId: string,
): Promise<ConfirmResult> {
  const address = link.updateTo?.toLowerCase();
  if (!address) return { ok: false, reason: "invalid" };
  try {
    // The mail to the new address proved the mailbox.
    await getPrisma().user.update({ where: { id: link.userId }, data: { email: address, emailVerified: true } });
  } catch (error) {
    // Taken meanwhile: the unique address stops the update, and the link stays as it was.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "emailTaken" };
    }
    throw error;
  }
  // A session opened by someone else must not outlive the move to a new address.
  await getPrisma().session.deleteMany({ where: { userId: link.userId, id: { not: sessionId } } });
  // A reset link mailed to the old address must not outlive the move either.
  await cancelPendingLinks(link.userId);
  return { ok: true, purpose: "change_email" };
}

export type ConfirmResult =
  | { ok: true; purpose: EmailLinkPurpose }
  | { ok: false; reason: "invalid" | "emailTaken" | "wrongAccount" };

/**
 * Read-only: which confirmation the verify page should offer and whose account it is for, or null for
 * a link that would be "invalid". It never uses the token — mail scanners and previews fetch links, so only the POST confirms.
 */
export async function emailTokenPurpose(token: string): Promise<{ purpose: EmailLinkPurpose; userId: string } | null> {
  const found = await peekEmailLink(token);
  return found && { purpose: found.purpose, userId: found.userId };
}

/**
 * Uses a verify or email change link. Call it from a POST only. `current` is the signed-in account: holding the
 * link is not enough, or someone who signed up with another person's address (or asked to move their account to
 * it) could get it confirmed by that person pressing the button. A link of another account is "wrongAccount" and
 * stays usable. A change of address ends the account's other sessions; the one confirming it stays.
 */
export async function confirmEmail(token: string, current: { userId: string; sessionId: string }): Promise<ConfirmResult> {
  const link = await peekEmailLink(token);
  if (!link) return { ok: false, reason: "invalid" };
  if (link.userId !== current.userId) return { ok: false, reason: "wrongAccount" };

  if (link.purpose === "change_email") return confirmEmailChange(link, current.sessionId);

  try {
    await auth.api.verifyEmail({ query: { token }, headers: await headers() });
  } catch (error) {
    if (!isAPIError(error)) throw error;
    console.error("[id] Better Auth refused a verify link:", error.body?.code ?? error.message);
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, purpose: link.purpose };
}
