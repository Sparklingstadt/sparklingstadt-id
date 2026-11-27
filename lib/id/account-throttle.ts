import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { clientIp } from "./client-ip.ts";
import { normalizeEmail } from "./validation.ts";

/** Attempt counters per address / account / IP (the `throttles` table); 15 minute windows. */
export type ThrottleStore = {
  /** Counts one attempt; false once `limit` is exceeded. */
  consume(key: string, limit: number): Promise<boolean>;
  reset(key: string): Promise<void>;
};

export type ThrottleInfo = {
  /** The normalized address; undefined when the request carries none or an invalid one. */
  email?: string;
  /** The address as typed (trimmed, lower case, cut to 254): counted per IP even when it is invalid. */
  rawEmail?: string;
  ip: string;
  /** The signed-in user, for the rules that need one. */
  userId?: string;
};

type Key = { key: string; limit: number; resetOnSuccess?: boolean };
/** `perUser`: the keys need the user (ThrottleInfo.userId), read from the session or the pending 2FA sign-in. */
export type ThrottleRule = { path: string; keys: (info: ThrottleInfo) => Key[]; perUser?: boolean };

/** The key formats are the ones the earlier lib/id/accounts.ts used, so counters carry over a deploy. */
const perIp = (prefix: string, limit = 10) => (info: ThrottleInfo): Key[] => [{ key: `${prefix}:${info.ip}`, limit }];
const passwordCheck = (info: ThrottleInfo): Key[] =>
  info.userId ? [{ key: `pwcheck:user:${info.userId}`, limit: 5, resetOnSuccess: true }] : [];
// The second step of a sign-in: 5 wrong codes per account (TOTP and backup codes together), counted again after a success.
const twoFactorCode = (info: ThrottleInfo): Key[] =>
  info.userId ? [{ key: `2fa:account:${info.userId}`, limit: 5, resetOnSuccess: true }] : [];

export const throttleRules: ThrottleRule[] = [
  {
    path: "/sign-in/email",
    keys: ({ email, rawEmail, ip }) => [
      { key: `login:ip:${ip}`, limit: 20 },
      // One address from one IP: 5 wrong passwords, counted again after a success.
      { key: `login:ipmail:${ip}:${email ?? rawEmail ?? ""}`, limit: 5, resetOnSuccess: true },
      // One account from every IP together (guessing spread over many addresses); a password reset clears it.
      ...(email ? [{ key: `login:mail:${email}`, limit: 30 }] : []),
    ],
  },
  { path: "/sign-up/email", keys: (info) => perIp("signup:ip")(info) },
  { path: "/send-verification-email", keys: (info) => perIp("resend:ip")(info) },
  { path: "/change-email", keys: (info) => perIp("emailchange:ip")(info) },
  { path: "/request-password-reset", keys: (info) => perIp("reset:ip")(info) },
  // Checking the current password: 5 wrong ones per account across both forms.
  { path: "/change-password", keys: passwordCheck, perUser: true },
  { path: "/verify-password", keys: passwordCheck, perUser: true },
  // Turning 2FA on or off and the other 2FA forms that take the password count with the password checks above.
  { path: "/two-factor/enable", keys: passwordCheck, perUser: true },
  { path: "/two-factor/disable", keys: passwordCheck, perUser: true },
  { path: "/two-factor/generate-backup-codes", keys: passwordCheck, perUser: true },
  { path: "/two-factor/get-totp-uri", keys: passwordCheck, perUser: true },
  { path: "/two-factor/verify-totp", keys: twoFactorCode, perUser: true },
  { path: "/two-factor/verify-backup-code", keys: twoFactorCode, perUser: true },
];

const ruleFor = (path: string) => throttleRules.find((rule) => rule.path === path);

/** Counts the attempt against every limit of the path (all of them, so no limit hides another); false when any is exceeded. */
export async function consumeRules(path: string, info: ThrottleInfo, store: ThrottleStore): Promise<boolean> {
  let allowed = true;
  for (const { key, limit } of ruleFor(path)?.keys(info) ?? []) {
    if (!(await store.consume(key, limit))) allowed = false;
  }
  return allowed;
}

/** After a success: counts again the limits that start over (and only those). */
export async function resetRules(path: string, info: ThrottleInfo, store: ThrottleStore): Promise<void> {
  for (const { key, resetOnSuccess } of ruleFor(path)?.keys(info) ?? []) {
    if (resetOnSuccess) await store.reset(key);
  }
}

/** The default store is the throttles table; loaded on first use so this module has no database import of its own. */
const tableStore: ThrottleStore = {
  consume: async (key, limit) => (await import("./throttle.ts")).consumeThrottle(key, limit),
  reset: async (key) => (await import("./throttle.ts")).resetThrottle(key),
};

function addressOf(body: unknown): Pick<ThrottleInfo, "email" | "rawEmail"> {
  const value = typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined;
  if (typeof value !== "string") return {};
  const rawEmail = value.trim().toLowerCase().slice(0, 254);
  try {
    return { email: normalizeEmail(value), rawEmail };
  } catch {
    return { rawEmail };
  }
}

/** Throttle counters the Better Auth rate limiter (per IP and path) cannot keep: per address, account and user. */
export function accountThrottle(store: ThrottleStore = tableStore): BetterAuthPlugin {
  const matcher = (context: { path?: string }) => ruleFor(context.path ?? "") !== undefined;
  return {
    id: "account-throttle",
    hooks: {
      before: [
        {
          matcher,
          handler: createAuthMiddleware(async (ctx) => {
            const info = await infoOf(ctx);
            if (!(await consumeRules(ctx.path, info, store))) {
              throw new APIError("TOO_MANY_REQUESTS", { code: "THROTTLED", message: "Too many attempts" });
            }
          }),
        },
      ],
      after: [
        {
          matcher,
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.context.returned instanceof Error) return;
            await resetRules(ctx.path, await infoOf(ctx), store);
          }),
        },
      ],
    },
  };
}

async function infoOf(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]): Promise<ThrottleInfo> {
  let userId: string | undefined;
  if (ruleFor(ctx.path)?.perUser) {
    const session = ctx.context.newSession ?? (await getSessionFromCtx(ctx).catch(() => null));
    userId = session?.user.id ?? (await pendingTwoFactorUser(ctx));
  }
  return { ...addressOf(ctx.body), ip: clientIp(ctx.headers ?? new Headers()), userId };
}

/**
 * The user of a password sign-in that waits for its 2FA code: the twoFactor plugin keeps no session until then, only
 * its signed `two_factor` cookie, which names a verification row holding the user's id.
 */
async function pendingTwoFactorUser(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]): Promise<string | undefined> {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret).catch(() => null);
  if (!identifier) return undefined;
  const row = await ctx.context.internalAdapter.findVerificationValue(identifier).catch(() => null);
  return row && new Date(row.expiresAt).getTime() > Date.now() ? row.value : undefined;
}
