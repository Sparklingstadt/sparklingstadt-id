/**
 * The OIDC URLs the clients have always used, and the Better Auth endpoints that serve them. One client writes these
 * in without reading discovery, so they stay. next.config.ts rewrites them to Better Auth's handler, which sees the
 * request under its original path and is given the Better Auth one (app/api/auth/[...all]/route.ts).
 * /oauth/logout is a Route Handler of its own.
 */
export const OIDC_URL_PATHS: Readonly<Record<string, string>> = {
  "/oauth/authorize": "/api/auth/oauth2/authorize",
  "/oauth/token": "/api/auth/oauth2/token",
  "/oauth/userinfo": "/api/auth/oauth2/userinfo",
  "/oauth/jwks": "/api/auth/jwks",
};
