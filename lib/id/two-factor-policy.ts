import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

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
      ],
    },
  } satisfies BetterAuthPlugin;
}
