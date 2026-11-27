import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

/** How long a proven password lets one passkey be added. */
export const PASSKEY_GRANT_MINUTES = 5;

/**
 * The grant is also bound to the browser that typed the password: the Server Action sets a random nonce in this
 * cookie (httpOnly, SameSite=Strict, only sent to the passkey endpoints) and the grant row keeps its hash. A copy of
 * the session cookie alone has the same session id but not the nonce, so it cannot use the grant.
 */
export const PASSKEY_GRANT_COOKIE = "passkey_add_grant";
export const PASSKEY_GRANT_PATH = "/api/auth/passkey";

export const newGrantNonce = () => randomBytes(32).toString("base64url");
export const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

function nonceMatches(nonce: string | null | undefined, storedHash: string): boolean {
  if (!nonce) return false;
  const actual = Buffer.from(hashNonce(nonce), "utf8");
  const expected = Buffer.from(storedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

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
            // No session: refused here too, not left to the plugin's registration.requireSession default.
            if (!session) throw new APIError("UNAUTHORIZED", { message: "Sign in to add a passkey" });
            const identifier = passkeyGrantIdentifier(session.session.id);
            const { internalAdapter } = ctx.context;
            const refuse = () => new APIError("FORBIDDEN", { code: "PASSWORD_REQUIRED", message: "The password is required to add a passkey" });
            // Looked at first, consumed only once the nonce matches: a request without it must not spend the owner's grant.
            const row = await internalAdapter.findVerificationValue(identifier);
            if (!row || new Date(row.expiresAt).getTime() <= Date.now()) throw refuse();
            if (!nonceMatches(ctx.getCookie(PASSKEY_GRANT_COOKIE), row.value)) throw refuse();
            if (ctx.path === VERIFY_PATH) {
              const used = await internalAdapter.consumeVerificationValue(identifier);
              if (!used || new Date(used.expiresAt).getTime() <= Date.now()) throw refuse();
              ctx.setCookie(PASSKEY_GRANT_COOKIE, "", { path: PASSKEY_GRANT_PATH, maxAge: 0 });
            }
          }),
        },
      ],
    },
  };
}
