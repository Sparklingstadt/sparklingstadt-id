import { createHash } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { routing } from "../../i18n/routing.ts";

/**
 * The oauth-provider plugin behind the contract the clients were built against (spec 4.2), where the plugin answers
 * differently: the authorize checks and their order, sending the user to the login page with `next`, the email
 * gate, client_secret_post next to client_secret_basic, a code spent by a wrong redemption, and `{ error }` bodies.
 * It acts on Better Auth's own paths, so /oauth/* (rewritten in next.config.ts) and /api/auth/oauth2/* behave alike.
 */

/** Where the clients come back to after signing in: the authorize URL they know. */
export const AUTHORIZE_PATH = "/oauth/authorize";

/**
 * The `prompt` values the authorize endpoint acts on (OIDC Core 3.1.2.1): `login` asks to sign in again even with a
 * session, `none` forbids any screen. `other` is true for any other value; `none` together with one is an error.
 */
export function parsePrompt(prompt: string | null): { login: boolean; none: boolean; other: boolean } {
  const values = (prompt ?? "").split(" ").filter((value) => value !== "");
  return {
    login: values.includes("login"),
    none: values.includes("none"),
    other: values.some((value) => value !== "none"),
  };
}

/**
 * The authorize path to come back to after signing in again: the same request without `prompt` and `max_age`, so
 * that the session just made issues the code instead of asking for the login again.
 */
export function authorizePathWithoutPrompt(pathname: string, params: URLSearchParams): string {
  const rest = new URLSearchParams(params);
  rest.delete("prompt");
  rest.delete("max_age");
  return `${pathname}?${rest}`;
}

/** Whether a session is older than `max_age` seconds (OIDC Core 3.1.2.1); a missing or malformed value never is. */
export function isOlderThanMaxAge(createdAt: Date, maxAge: string | null, now = Date.now()): boolean {
  if (maxAge === null || !/^\d+$/.test(maxAge)) return false;
  return now - createdAt.getTime() >= Number(maxAge) * 1000;
}

/** A page path in the visitor's language (NEXT_LOCALE), as next-intl's `as-needed` prefix writes it. */
export function localizedPath(cookieLocale: string | null | undefined, href: string): string {
  const locale = (routing.locales as readonly string[]).includes(cookieLocale ?? "") ? cookieLocale : routing.defaultLocale;
  return locale === routing.defaultLocale ? href : `/${locale}${href}`;
}

/** RFC 7636: an S256 challenge is the base64url SHA-256 of the verifier, 43 characters. */
export function isS256Challenge(value: string | null): boolean {
  return value !== null && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** How the plugin stores codes and opaque tokens (its default hasher): SHA-256, base64url without padding. */
export function storedTokenOf(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** An Authorization: Basic value with each part form-encoded first (RFC 6749 §2.3.1). */
export function basicAuthorization(id: string, secret: string): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
  return `Basic ${Buffer.from(`${encode(id)}:${encode(secret)}`).toString("base64")}`;
}

// The locale is not known yet when the client itself is invalid, so the page shows all three.
const ERROR_PAGE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sparklingstadt ID</title>
</head>
<body>
<h1>Sparklingstadt ID</h1>
<p lang="ja">ログインの要求が正しくありません。利用中のサービスに戻って、もう一度お試しください。</p>
<p lang="zh-CN">登录请求无效。请返回正在使用的服务后重试。</p>
<p lang="zh-TW">登入請求無效。請返回正在使用的服務後重試。</p>
</body>
</html>
`;

const NO_STORE = { "Cache-Control": "no-store" };

function errorPage(status: number): Response {
  return new Response(ERROR_PAGE, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
  });
}

/** One string value of a request parameter; a missing or repeated one is null. */
function single(source: Record<string, unknown> | undefined, name: string): string | null {
  const value = source?.[name];
  return typeof value === "string" ? value : null;
}

function toSearchParams(source: Record<string, unknown> | undefined): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(source ?? {})) {
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
    else if (value !== undefined && value !== null) params.append(key, String(value));
  }
  return params;
}

/** Endpoints the provider does not offer (spec 4.2 使わない機能): no options turns them off. */
const BLOCKED_PATHS = new Set(["/oauth2/introspect", "/oauth2/revoke", "/oauth2/register", "/token"]);

type RegisteredClient = { redirectUris?: string[] | null; disabled?: boolean | null };

export function oidcCompat() {
  return {
    id: "oidc-compat",
    hooks: {
      before: [
        {
          matcher: (ctx) => BLOCKED_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND");
          }),
        },
        {
          // The steps of the authorize endpoint from before Better Auth, in their order. A request that passes them
          // all comes from a signed-in, confirmed user, and the plugin issues the code.
          matcher: (ctx) => ctx.path === "/oauth2/authorize",
          handler: createAuthMiddleware(async (ctx) => {
            const source = (ctx.method === "POST" ? ctx.body : ctx.query) as Record<string, unknown> | undefined;
            const issuer = ctx.context.baseURL.replace(/\/+$/, "");

            // 1. Unknown client or unregistered redirect_uri: never redirect.
            const clientId = single(source, "client_id");
            const redirectUri = single(source, "redirect_uri");
            const client = clientId
              ? await ctx.context.adapter.findOne<RegisteredClient>({
                  model: "oauthClient",
                  where: [{ field: "clientId", value: clientId }],
                })
              : null;
            if (!client || client.disabled || !redirectUri || !(client.redirectUris ?? []).includes(redirectUri)) {
              return errorPage(400);
            }

            // 2. Other errors go back to the client.
            const state = single(source, "state");
            const backToClient = (error: string) => {
              const url = new URL(redirectUri);
              url.searchParams.set("error", error);
              if (state !== null) url.searchParams.set("state", state);
              url.searchParams.set("iss", issuer);
              return ctx.redirect(url.toString());
            };
            if (single(source, "response_type") !== "code") throw backToClient("unsupported_response_type");
            const scope = single(source, "scope") ?? "";
            if (
              !scope.split(" ").includes("openid") ||
              !isS256Challenge(single(source, "code_challenge")) ||
              single(source, "code_challenge_method") !== "S256"
            ) {
              throw backToClient("invalid_request");
            }

            // 3. prompt=none never shows a screen: answer with an error instead of sending the user to log in.
            const prompt = parsePrompt(single(source, "prompt"));
            if (prompt.none && prompt.other) throw backToClient("invalid_request");

            // 4. Not signed in: log in, then come back to this exact request. With prompt=login (or a session older
            //    than max_age), log in even when signed in, then come back without them, so that the new session
            //    issues the code.
            const params = toSearchParams(source);
            const rawSearch = ctx.method === "GET" && ctx.request ? new URL(ctx.request.url).search : `?${params}`;
            const locale = ctx.getCookie("NEXT_LOCALE");
            const loginPath = localizedPath(locale, "/login");
            const logInAgain = () => {
              const next = authorizePathWithoutPrompt(AUTHORIZE_PATH, params);
              return ctx.redirect(`${loginPath}?${new URLSearchParams({ next, reauth: "1" })}`);
            };
            if (prompt.login) throw logInAgain();
            const session = await getSessionFromCtx(ctx);
            if (!session) {
              if (prompt.none) throw backToClient("login_required");
              throw ctx.redirect(`${loginPath}?${new URLSearchParams({ next: `${AUTHORIZE_PATH}${rawSearch}` })}`);
            }
            if (isOlderThanMaxAge(new Date(session.session.createdAt), single(source, "max_age"))) {
              if (prompt.none) throw backToClient("login_required");
              throw logInAgain();
            }

            // 5. Unconfirmed email: the account page asks to confirm it first.
            if (!session.user.emailVerified) {
              if (prompt.none) throw backToClient("interaction_required");
              throw ctx.redirect(`${localizedPath(locale, "/account")}?verify=required`);
            }
          }),
        },
        {
          // Every client is registered for client_secret_basic, which the plugin then holds it to. A
          // client_secret_post request is turned into the same credentials in the Authorization header, so both keep
          // working. A request with no client authentication at all is answered as before: 401 invalid_client.
          matcher: (ctx) => ctx.path === "/oauth2/token",
          handler: createAuthMiddleware(async (ctx) => {
            const request = ctx.request;
            if (!request || request.headers.get("authorization")) return;
            const body = (ctx.body ?? {}) as Record<string, unknown>;
            const id = single(body, "client_id");
            const secret = single(body, "client_secret");
            if (!id || !secret) {
              throw new APIError("UNAUTHORIZED", { error: "invalid_client" }, {
                "WWW-Authenticate": 'Basic realm="oauth"',
                ...NO_STORE,
              });
            }
            const form = new URLSearchParams(await request.clone().text());
            form.delete("client_secret");
            const headers = new Headers(request.headers);
            headers.set("authorization", basicAuthorization(id, secret));
            headers.delete("content-length");
            delete body.client_secret;
            return {
              context: {
                request: new Request(request.url, { method: request.method, headers, body: form.toString() }),
              },
            };
          }),
        },
      ],
      after: [
        {
          // Error bodies are `{ error }` alone, as before. A code that a redemption failed for is spent, as before:
          // whoever holds a stolen code gets one try, and the client it was issued to then cannot redeem it either.
          matcher: (ctx) => ctx.path === "/oauth2/token",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            if (!isAPIError(returned)) return;
            const error = (returned.body as { error?: unknown } | undefined)?.error;
            const code = single(ctx.body as Record<string, unknown> | undefined, "code");
            if (error === "invalid_grant" && code) {
              await ctx.context.adapter.deleteMany({
                model: "verification",
                where: [{ field: "identifier", value: storedTokenOf(code) }],
              });
            }
            const headers = new Headers(returned.headers);
            headers.set("Cache-Control", "no-store");
            throw new APIError(returned.status, { error: typeof error === "string" ? error : "invalid_request" }, headers);
          }),
        },
        {
          // A token that cannot be used (missing, unknown, expired, or its user gone) is 401 invalid_token, as before.
          matcher: (ctx) => ctx.path === "/oauth2/userinfo",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            if (!isAPIError(returned)) return;
            const body = returned.body as { error?: unknown; error_description?: unknown } | undefined;
            const userGone = returned.statusCode === 400 && body?.error_description === "user not found";
            if (returned.statusCode !== 401 && !userGone) {
              throw new APIError(returned.status, { error: typeof body?.error === "string" ? body.error : "invalid_request" }, NO_STORE);
            }
            throw new APIError("UNAUTHORIZED", { error: "invalid_token" }, {
              "WWW-Authenticate": 'Bearer error="invalid_token"',
              ...NO_STORE,
            });
          }),
        },
        {
          // Clients read the keys again on a kid they do not know, so a cached key set is fine.
          matcher: (ctx) => ctx.path === "/jwks",
          handler: createAuthMiddleware(async (ctx) => {
            ctx.setHeader("Cache-Control", "public, max-age=600");
          }),
        },
        {
          // Signing in again over a session (prompt=login) replaces it rather than leaving its row behind: a copy of
          // the old cookie must not stay signed in.
          matcher: (ctx) => (ctx.path ?? "").startsWith("/sign-in/"),
          handler: createAuthMiddleware(async (ctx) => {
            const created = ctx.context.newSession;
            if (!created) return;
            const previous = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
            if (previous && previous !== created.session.token) await ctx.context.internalAdapter.deleteSession(previous);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
