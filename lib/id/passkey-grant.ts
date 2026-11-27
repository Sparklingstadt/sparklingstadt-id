import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

/** How long a proven password lets one passkey be added. */
export const PASSKEY_GRANT_MINUTES = 5;

/** The two endpoints of the registration ceremony (@better-auth/passkey); both need the grant. */
export const GENERATE_PATH = "/passkey/generate-register-options";
export const VERIFY_PATH = "/passkey/verify-registration";

/**
 * The ba_verifications identifier of a grant. Bound to the session id, so a grant of one session (a cookie stolen
 * elsewhere, or an older login) is of no use to another.
 */
export const passkeyGrantIdentifier = (sessionId: string) => `passkey-add:${sessionId}`;

/**
 * Registering a passkey needs the account password typed just before (owner's decision, 2026-11-27): someone with only
 * a stolen session cookie must not plant a passkey, which signs in without the 2FA code. The password is checked
 * server-side by the account page's Server Action (grantPasskeyAdd in lib/id/accounts.ts), which stores a grant row
 * for the session for PASSKEY_GRANT_MINUTES. This hook is the enforcement, for every caller of the two registration
 * endpoints: generating options needs a valid grant, and verifying the registration consumes it, so one password
 * entry adds one passkey. Runs before the endpoints' own session middleware, hence it reads the session itself and
 * leaves a missing one to that middleware (401).
 */
export function passkeyPasswordGate(): BetterAuthPlugin {
  return {
    id: "passkey-password-gate",
    hooks: {
      before: [
        {
          matcher: (context) => context.path === GENERATE_PATH || context.path === VERIFY_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx).catch(() => null);
            if (!session) return;
            const identifier = passkeyGrantIdentifier(session.session.id);
            const { internalAdapter } = ctx.context;
            const row =
              ctx.path === VERIFY_PATH
                ? await internalAdapter.consumeVerificationValue(identifier)
                : await internalAdapter.findVerificationValue(identifier);
            if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
              throw new APIError("FORBIDDEN", { code: "PASSWORD_REQUIRED", message: "The password is required to add a passkey" });
            }
          }),
        },
      ],
    },
  };
}
