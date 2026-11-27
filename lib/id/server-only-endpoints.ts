import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * Better Auth endpoints that only the app's server actions call (lib/id/accounts.ts, through auth.api.*). Each one
 * skips over HTTP what the action adds around it: the input rules of validation.ts (checkPassword,
 * normalizeDisplayName, normalizeEmail), the current-password check and the notice to the old address on an email
 * change, "only the latest email change link counts", ending the other sessions and cancelling the pending links.
 * /verify-email would move an address from an earlier change link with no session at all, and /reset-password/:token
 * is the redirect of a mail link the app never sends (its mails link to its own pages).
 */
export const SERVER_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/sign-up/email",
  "/send-verification-email",
  "/verify-email",
  "/update-user",
  "/verify-password",
  "/change-email",
  "/change-password",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
]);

/** Whether a hook context is an HTTP request (the router passes the Request; auth.api.* from the server passes none). */
export function isServerOnlyOverHttp(ctx: { path?: string; request?: Request }): boolean {
  return ctx.request !== undefined && SERVER_ONLY_PATHS.has(ctx.path ?? "");
}

/**
 * Answers 404 to an HTTP request for one of SERVER_ONLY_PATHS, as if the endpoint did not exist. The browser calls
 * only the sign-in steps and the signed-in widgets over HTTP (/sign-in/email, /passkey/*, /two-factor/*,
 * /get-session, /sign-out); everything else goes through a server action.
 */
export function serverOnlyEndpoints() {
  return {
    id: "server-only-endpoints",
    hooks: {
      before: [
        {
          matcher: (ctx) => isServerOnlyOverHttp(ctx),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND");
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
