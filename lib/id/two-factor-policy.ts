import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

/** The twoFactor endpoints that accept `trustDevice`, which would let the browser skip the code for 30 days. */
const VERIFY_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/verify-otp"]);

/**
 * No "trust this device" (spec 4.5, 2): the login page never asks for it, and a request that does is treated as if
 * it had not, so every password sign-in of an account with 2FA on asks for a code.
 */
export function twoFactorPolicy() {
  return {
    id: "two-factor-policy",
    hooks: {
      before: [
        {
          matcher: (ctx) => VERIFY_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as Record<string, unknown> | undefined;
            if (typeof body === "object" && body !== null) delete body.trustDevice;
          }),
        },
        {
          // Turning 2FA on needs a confirmed address. Anyone can sign up with an address that is not theirs and sign
          // in before it is confirmed; a second factor left there would outlive the owner's password reset (which
          // keeps 2FA), and the owner of the mailbox could never sign in. No session: left to the endpoint (401).
          matcher: (ctx) => ctx.path === "/two-factor/enable",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx).catch(() => null);
            if (session && !session.user.emailVerified) {
              throw new APIError("FORBIDDEN", {
                code: "EMAIL_NOT_VERIFIED",
                message: "Confirm the email address before turning two-factor authentication on",
              });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
