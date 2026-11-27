import { compactVerify, createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet } from "jose";

/** The logout request's parameters that the logout question carries over to its answer. */
export const LOGOUT_PARAMS = ["post_logout_redirect_uri", "client_id", "id_token_hint", "state"] as const;

/** What the logout checks need from the rest of the server (replaced in the unit tests). */
export type LogoutDeps = {
  issuer: string;
  /** The public keys that sign this server's ID tokens. */
  jwks: () => Promise<JSONWebKeySet>;
  /** The post-logout addresses registered for a client, or null when there is no such client. */
  postLogoutUris: (clientId: string) => Promise<string[] | null>;
};

async function defaultDeps(): Promise<LogoutDeps> {
  const [{ auth }, { findClientPostLogoutUris }, { authOptionsFrom }] = await Promise.all([
    import("@/lib/auth"),
    import("./client-import"),
    import("./auth-options"),
  ]);
  return {
    issuer: authOptionsFrom({ BETTER_AUTH_SECRET: "-", ...process.env }).baseURL,
    jwks: () => auth.api.getJwks() as Promise<JSONWebKeySet>,
    postLogoutUris: (clientId) => findClientPostLogoutUris(clientId),
  };
}

/**
 * The subject and audiences of an ID token this server signed (ES256, with the keys of the jwt plugin), or null.
 * The expiry is ignored: the hint only names who is logging out.
 */
async function readHint(deps: LogoutDeps, hint: string): Promise<{ sub: unknown; audiences: string[] } | null> {
  try {
    if (decodeProtectedHeader(hint).alg !== "ES256") return null;
    const { payload } = await compactVerify(hint, createLocalJWKSet(await deps.jwks()), { algorithms: ["ES256"] });
    const claims: unknown = JSON.parse(new TextDecoder().decode(payload));
    if (typeof claims !== "object" || claims === null) return null;
    const { iss, aud, sub } = claims as Record<string, unknown>;
    if (iss !== deps.issuer) return null;
    const audiences =
      typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud.filter((a): a is string => typeof a === "string") : [];
    return { sub, audiences };
  } catch {
    return null;
  }
}

/**
 * The user an `id_token_hint` names, or null without a usable one. Only a client that this user signed in to holds
 * such a token, so a logout request carrying the signed-in user's own ID token comes from a client, not from a link
 * someone planted. It must be an ID token of a registered client: an access token is signed with the same key.
 */
export async function logoutHintSubject(params: URLSearchParams, deps?: LogoutDeps): Promise<string | null> {
  const hint = params.get("id_token_hint");
  if (!hint) return null;
  const d = deps ?? (await defaultDeps());
  const claims = await readHint(d, hint);
  if (!claims || typeof claims.sub !== "string") return null;
  for (const audience of claims.audiences) if ((await d.postLogoutUris(audience)) !== null) return claims.sub;
  return null;
}

/**
 * Where to send the user after logout, or null to stay on our own signed-out page.
 * The target must be registered for the client, exactly as written. The client comes from `client_id`, or from the
 * audience of an `id_token_hint` that this server signed (its expiry is ignored). When both are given they must agree.
 */
export async function resolvePostLogoutRedirect(params: URLSearchParams, deps?: LogoutDeps): Promise<string | null> {
  const uri = params.get("post_logout_redirect_uri");
  if (!uri) return null;

  const clientId = params.get("client_id");
  const hint = params.get("id_token_hint");
  const d = deps ?? (await defaultDeps());
  let audiences: string[] | null = null;
  if (hint) {
    const claims = await readHint(d, hint);
    if (!claims) return null;
    ({ audiences } = claims);
  }

  let registered: string[] | null = null;
  if (clientId) {
    if (audiences && !audiences.includes(clientId)) return null;
    registered = await d.postLogoutUris(clientId);
  } else if (audiences) {
    for (const audience of audiences) {
      registered = await d.postLogoutUris(audience);
      if (registered) break;
    }
  } else {
    return null;
  }
  if (!registered?.includes(uri)) return null;

  const state = params.get("state");
  if (!state) return uri;
  const target = new URL(uri);
  target.searchParams.set("state", state);
  return target.toString();
}
