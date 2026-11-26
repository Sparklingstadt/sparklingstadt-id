import { after } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";
import { sendMail, type MailKind } from "./mailer.ts";
import { revokeSessions } from "./session.ts";
import { consumeThrottle, resetThrottle } from "./throttle.ts";
import { hashToken, newToken } from "./tokens.ts";
import { checkPassword, normalizeDisplayName, normalizeEmail, ValidationError } from "./validation.ts";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

// Compared against when the address is unknown so both paths take similar time.
let unknownUserHash: Promise<string> | undefined;
const dummyHash = () => (unknownUserHash ??= hashPassword("unknown-id-user"));

/** `${ID_ISSUER}` + the locale-aware path, e.g. https://…/zh-cn/verify */
function portalUrl(href: string, locale: Locale): string {
  const issuer = process.env.ID_ISSUER?.trim().replace(/\/+$/, "");
  if (!issuer) throw new Error("Sparklingstadt ID is not configured: missing ID_ISSUER");
  return `${issuer}${getPathname({ href, locale })}`;
}

/** Never throws: a failed send must look the same to the visitor (no enumeration). */
async function sendMailQuietly(input: Parameters<typeof sendMail>[0]): Promise<void> {
  try {
    await sendMail(input);
  } catch (error) {
    // The error never contains the link; log only the kind and the reason.
    console.error(`[id] failed to send a ${input.kind} mail:`, error instanceof Error ? error.message : error);
  }
}

function verifyMail(email: string, token: string, locale: Locale): { to: string; kind: MailKind; locale: Locale; link: string } {
  return { to: email, kind: "verify", locale, link: `${portalUrl("/verify", locale)}?token=${token}` };
}

function verifyTokenData(email: string, token: string) {
  return {
    purpose: "verify" as const,
    tokenHash: hashToken(token),
    email,
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  };
}

/** Throws ValidationError for bad input. Same result whether or not the address is taken. */
export async function signUp(input: {
  email: string;
  displayName: string;
  password: string;
  locale: Locale;
  ip: string;
}): Promise<"sent" | "throttled"> {
  const email = normalizeEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName);
  const password = checkPassword(input.password);
  if (!(await consumeThrottle(`signup:ip:${input.ip}`, 10))) return "throttled";

  // Hash in both branches so the response time does not reveal a registered address.
  const passwordHash = await hashPassword(password);
  const token = newToken();
  let created = false;
  if (!(await getPrisma().legacyUser.findUnique({ where: { email }, select: { id: true } }))) {
    try {
      await getPrisma().legacyUser.create({
        data: { email, displayName, passwordHash, emailTokens: { create: verifyTokenData(email, token) } },
      });
      created = true;
    } catch (error) {
      // Lost a race with another sign-up for the same address: treat it as registered.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }

  await sendMailQuietly(
    created
      ? verifyMail(email, token, input.locale)
      : { to: email, kind: "alreadyRegistered", locale: input.locale, link: portalUrl("/forgot", input.locale) },
  );
  return "sent";
}

export type ConfirmResult =
  | { ok: true; purpose: "verify" | "change_email" }
  | { ok: false; reason: "invalid" | "emailTaken" | "wrongAccount" };

/**
 * Read-only: which confirmation the verify page should offer and whose account it is for, or null for
 * a link that would be "invalid".
 * It never claims the token — mail scanners and previews fetch links, so only the POST confirms.
 */
export async function emailTokenPurpose(
  token: string,
): Promise<{ purpose: "verify" | "change_email"; userId: string } | null> {
  if (!token || token.length > 128) return null;
  const row = await getPrisma().emailToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { email: true } } },
  });
  if (!row || (row.purpose !== "verify" && row.purpose !== "change_email")) return null;
  if (row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  // Same rule as confirmEmailToken: a verify link for an address the account no longer has proves nothing.
  if (row.purpose === "verify" && row.user.email !== row.email) return null;
  return { purpose: row.purpose, userId: row.userId };
}

/**
 * Uses a `verify` or `change_email` token once. Expired, used or unknown tokens are "invalid". Call it from a POST only.
 * `userId` is the signed-in account: holding the link is not enough, or someone who signed up with
 * another person's address (or asked to move their account to it) could get it confirmed by that
 * person pressing the button. A token of another account is "wrongAccount" and stays unused.
 * A change of address ends the account's other sessions; `sessionId`, the one confirming it, stays
 * (replacing its cookie here would redraw the verify page, which then shows the used link as invalid).
 */
export async function confirmEmailToken(token: string, userId: string, sessionId: string): Promise<ConfirmResult> {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (!token || token.length > 128) return invalid;

  try {
    return await getPrisma().$transaction(async (tx) => {
      const now = new Date();
      const row = await tx.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!row || (row.purpose !== "verify" && row.purpose !== "change_email")) return invalid;
      if (row.userId !== userId) return { ok: false, reason: "wrongAccount" } as const;

      // Conditional UPDATE: only one request can claim the token.
      const claimed = await tx.emailToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return invalid;

      if (row.purpose === "change_email") {
        // `row.email` is the new address. Taken meanwhile → P2002 rolls the whole transaction back.
        await tx.legacyUser.update({ where: { id: row.userId }, data: { email: row.email, emailVerifiedAt: now } });
        // Links to other addresses asked for earlier must not move the account again.
        await tx.emailToken.updateMany({
          where: { userId: row.userId, purpose: "change_email", usedAt: null },
          data: { usedAt: now },
        });
        // A session opened by someone else must not outlive the move to a new address.
        await tx.legacySession.deleteMany({ where: { userId: row.userId, id: { not: sessionId } } });
        return { ok: true, purpose: "change_email" } as const;
      }

      const user = await tx.legacyUser.findUnique({
        where: { id: row.userId },
        select: { email: true, emailVerifiedAt: true },
      });
      // The address changed after this mail was sent: it no longer proves anything.
      if (!user || user.email !== row.email) return invalid;
      if (!user.emailVerifiedAt) {
        await tx.legacyUser.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
      }
      return { ok: true, purpose: "verify" } as const;
    });
  } catch (error) {
    // The token stays unused (rolled back), so opening the link again shows the same answer.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, reason: "emailTaken" };
    }
    throw error;
  }
}

export type LogInResult =
  | { ok: true; userId: string; sessionVersion: number }
  | { ok: false; reason: "invalid" | "throttled" };

/** The count of login attempts for one account, from every IP address together. */
const loginAccountKey = (email: string) => `login:mail:${email}`;

/**
 * Every attempt counts against all three limits; success resets the IP+address counter. The per-account
 * limit stops guessing spread over many IP addresses; a password reset clears it, so whoever holds the
 * mailbox is never locked out by someone else's attempts.
 */
export async function logIn(input: { email: string; password: string; ip: string }): Promise<LogInResult> {
  let email: string | undefined;
  try {
    email = normalizeEmail(input.email);
  } catch {
    email = undefined;
  }
  const mailKey = `login:ipmail:${input.ip}:${email ?? input.email.trim().toLowerCase().slice(0, 254)}`;
  const ipAllowed = await consumeThrottle(`login:ip:${input.ip}`, 20);
  const mailAllowed = await consumeThrottle(mailKey, 5);
  const accountAllowed = email ? await consumeThrottle(loginAccountKey(email), 30) : true;
  if (!ipAllowed || !mailAllowed || !accountAllowed) return { ok: false, reason: "throttled" };

  const user = email
    ? await getPrisma().legacyUser.findUnique({
        where: { email },
        select: { id: true, passwordHash: true, sessionVersion: true },
      })
    : null;
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash()));
  const outdated = user ? needsRehash(user.passwordHash) : false;
  // A hash with earlier, cheaper parameters answers sooner than the dummy: spend the difference, so that
  // a registered address does not stand out by its response time.
  if (outdated) await verifyPassword(input.password, await dummyHash());
  if (!user || !valid) return { ok: false, reason: "invalid" };

  if (outdated) {
    // The password is at hand: store it with the current parameters (unless it was changed meanwhile).
    await getPrisma().legacyUser.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: { passwordHash: await hashPassword(input.password) },
    });
  }
  await resetThrottle(mailKey);
  return { ok: true, userId: user.id, sessionVersion: user.sessionVersion };
}

/** Sends a new verify link to the current address. Mail failures propagate to the caller. */
export async function resendVerification(
  userId: string,
  locale: Locale,
  ip: string,
): Promise<"sent" | "throttled" | "alreadyVerified"> {
  const user = await getPrisma().legacyUser.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true },
  });
  if (user.emailVerifiedAt) return "alreadyVerified";
  if (!(await consumeThrottle(`resend:ip:${ip}`, 10))) return "throttled";

  const token = newToken();
  await getPrisma().emailToken.create({ data: { userId, ...verifyTokenData(user.email, token) } });
  await sendMail(verifyMail(user.email, token, locale));
  return "sent";
}

/** Throws ValidationError for a bad name. Returns the stored (trimmed) name. */
export async function changeDisplayName(userId: string, value: string): Promise<string> {
  const displayName = normalizeDisplayName(value);
  await getPrisma().legacyUser.update({ where: { id: userId }, data: { displayName } });
  return displayName;
}

/**
 * Counts one current-password check against `pwcheck:user:<id>` (5 per window, reset on success)
 * so a stolen session cannot guess the password through the my page forms.
 */
async function checkCurrentPassword(userId: string, current: string): Promise<"ok" | "wrongPassword" | "throttled"> {
  const key = `pwcheck:user:${userId}`;
  if (!(await consumeThrottle(key, 5))) return "throttled";
  const user = await getPrisma().legacyUser.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!(await verifyPassword(current, user.passwordHash))) return "wrongPassword";
  await resetThrottle(key);
  return "ok";
}

/**
 * Mails a `change_email` link to the NEW address; the account keeps the old one until it is opened.
 * The CURRENT address is told about the request (not where to), with the link to reset the password:
 * a reset cancels the request and revokes every session, should someone else have asked.
 * Same result whether or not the new address is taken (that is only told when the link is opened).
 * Throws ValidationError for a bad address, or code "sameEmail" for the current one.
 */
export async function requestEmailChange(
  userId: string,
  newEmail: string,
  currentPassword: string,
  locale: Locale,
  ip: string,
): Promise<"sent" | "throttled" | "wrongPassword"> {
  const email = normalizeEmail(newEmail);
  const user = await getPrisma().legacyUser.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  if (user.email === email) throw new ValidationError("email", "sameEmail");
  const checked = await checkCurrentPassword(userId, currentPassword);
  if (checked !== "ok") return checked;
  if (!(await consumeThrottle(`emailchange:ip:${ip}`, 10))) return "throttled";

  const token = newToken();
  // Only the latest request stays valid: a link to a mistyped address must not work after a new one is asked for.
  await getPrisma().$transaction([
    getPrisma().emailToken.updateMany({
      where: { userId, purpose: "change_email", usedAt: null },
      data: { usedAt: new Date() },
    }),
    getPrisma().emailToken.create({
      data: { userId, ...verifyTokenData(email, token), purpose: "change_email" },
    }),
  ]);
  await sendMailQuietly({
    to: email,
    kind: "changeEmail",
    locale,
    link: `${portalUrl("/verify", locale)}?token=${token}`,
  });
  await sendMailQuietly({ to: user.email, kind: "emailChangeRequested", locale, link: portalUrl("/forgot", locale) });
  return "sent";
}

export type ChangePasswordResult =
  | { ok: true; sessionVersion: number }
  | { ok: false; reason: "wrongPassword" | "throttled" };

/**
 * Throws ValidationError for a bad new password. On success, in one transaction, every session
 * and every pending email change / password reset link of the user is revoked; the caller signs
 * the current browser in again with the returned `sessionVersion`.
 */
export async function changePassword(userId: string, current: string, next: string): Promise<ChangePasswordResult> {
  const password = checkPassword(next);
  const checked = await checkCurrentPassword(userId, current);
  if (checked !== "ok") return { ok: false, reason: checked };

  const passwordHash = await hashPassword(password);
  const sessionVersion = await getPrisma().$transaction(async (tx) => {
    await tx.legacyUser.update({ where: { id: userId }, data: { passwordHash } });
    // Links requested from a stolen session must not outlive it.
    await tx.emailToken.updateMany({
      where: { userId, usedAt: null, purpose: { in: ["change_email", "reset_password"] } },
      data: { usedAt: new Date() },
    });
    return revokeSessions(userId, tx);
  });
  return { ok: true, sessionVersion };
}

/**
 * Mails a `reset_password` link when the address belongs to an account. The answer is "sent"
 * either way (also for an invalid address), and the mail goes out after the response so a
 * known address does not answer more slowly than an unknown one.
 */
export async function requestPasswordReset(email: string, locale: Locale, ip: string): Promise<"sent" | "throttled"> {
  if (!(await consumeThrottle(`reset:ip:${ip}`, 10))) return "throttled";
  let normalized: string;
  try {
    normalized = normalizeEmail(email);
  } catch (error) {
    if (error instanceof ValidationError) return "sent";
    throw error;
  }

  const user = await getPrisma().legacyUser.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!user) return "sent";
  const token = newToken();
  await getPrisma().emailToken.create({
    data: {
      userId: user.id,
      purpose: "reset_password",
      tokenHash: hashToken(token),
      email: normalized,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  const link = `${portalUrl("/reset", locale)}?token=${token}`;
  after(() => sendMailQuietly({ to: normalized, kind: "resetPassword", locale, link }));
  return "sent";
}

/** The usable `reset_password` row for `token`, or null (unknown, used, expired, or the address changed since). */
async function findResetToken(token: string, db: Prisma.TransactionClient = getPrisma()) {
  if (!token || token.length > 128) return null;
  const row = await db.emailToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { email: true, emailVerifiedAt: true } } },
  });
  if (!row || row.purpose !== "reset_password" || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  // The link went to an address the account no longer has: it proves nothing about the account.
  if (row.user.email !== row.email) return null;
  return row;
}

/** Whether the reset page should offer the form (the action checks again). */
export async function isResetTokenUsable(token: string): Promise<boolean> {
  return (await findResetToken(token)) !== null;
}

export type ResetPasswordResult = { ok: true } | { ok: false; reason: "invalid" };

/**
 * Throws ValidationError for a bad password. Uses the link once; in one transaction it sets the
 * password, marks the address verified (the mail proved the mailbox), cancels the user's other
 * pending email change / reset links and revokes every session. It also clears the account's login
 * attempt count: the mailbox owner can sign in right away, whatever others have tried.
 */
export async function resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
  const checked = checkPassword(password);
  const invalid = { ok: false, reason: "invalid" } as const;
  if (!(await findResetToken(token))) return invalid;

  const passwordHash = await hashPassword(checked);
  const result = await getPrisma().$transaction(async (tx) => {
    const now = new Date();
    const row = await findResetToken(token, tx);
    if (!row) return invalid;
    // Conditional UPDATE: only one request can claim the token.
    const claimed = await tx.emailToken.updateMany({
      where: { id: row.id, purpose: "reset_password", usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return invalid;

    await tx.legacyUser.update({
      where: { id: row.userId },
      data: { passwordHash, ...(row.user.emailVerifiedAt ? {} : { emailVerifiedAt: now }) },
    });
    await tx.emailToken.updateMany({
      where: { userId: row.userId, usedAt: null, purpose: { in: ["change_email", "reset_password"] } },
      data: { usedAt: now },
    });
    await revokeSessions(row.userId, tx);
    return { ok: true, email: row.email } as const;
  });
  if (!result.ok) return result;
  await resetThrottle(loginAccountKey(result.email));
  return { ok: true };
}
