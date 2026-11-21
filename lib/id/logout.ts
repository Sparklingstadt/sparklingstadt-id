import { findClient } from "./clients.ts";
import type { OidcConfig } from "./config.ts";
import { verifyJwt } from "./jwt.ts";

/** The logout request's parameters that the logout question carries over to its answer. */
export const LOGOUT_PARAMS = ["post_logout_redirect_uri", "client_id", "id_token_hint", "state"] as const;

/** The subject and audiences of a token this server signed (expiry ignored), or null. */
function readHint(config: OidcConfig, hint: string): { sub: unknown; audiences: string[] } | null {
  const claims = verifyJwt(hint, config.publicKeys, 0, { checkExpiry: false });
  if (!claims || claims.iss !== config.issuer) return null;
  const { aud, sub } = claims;
  const audiences =
    typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud.filter((a): a is string => typeof a === "string") : [];
  return { sub, audiences };
}

/**
 * The user an `id_token_hint` names, or null without a usable one. Only a client that this user signed in to holds
 * such a token, so a logout request carrying the signed-in user's own ID token comes from a client, not from a link
 * someone planted. It must be an ID token of a registered client: an access token is signed with the same key.
 */
export function logoutHintSubject(config: OidcConfig, params: URLSearchParams): string | null {
  const hint = params.get("id_token_hint");
  if (!hint) return null;
  const claims = readHint(config, hint);
  if (!claims || typeof claims.sub !== "string") return null;
  return claims.audiences.some((audience) => findClient(config.clients, audience)) ? claims.sub : null;
}

/**
 * Where to send the user after logout, or null to stay on our own signed-out page.
 * The target must be registered for the client. The client comes from `client_id`, or from the audience of an
 * `id_token_hint` that this server signed (its expiry is ignored: the hint only names who is logging out).
 * When both are given they must agree.
 */
export function resolvePostLogoutRedirect(config: OidcConfig, params: URLSearchParams): string | null {
  const uri = params.get("post_logout_redirect_uri");
  if (!uri) return null;

  const clientId = params.get("client_id");
  const hint = params.get("id_token_hint");
  let audiences: string[] | null = null;
  if (hint) {
    const claims = readHint(config, hint);
    if (!claims) return null;
    ({ audiences } = claims);
  }

  let id: string | null;
  if (clientId) {
    if (audiences && !audiences.includes(clientId)) return null;
    id = clientId;
  } else if (audiences) {
    id = audiences.find((a) => findClient(config.clients, a)) ?? null;
  } else {
    return null;
  }

  const client = findClient(config.clients, id);
  if (!client || !client.postLogoutRedirectUris.includes(uri)) return null;

  const state = params.get("state");
  if (!state) return uri;
  const target = new URL(uri);
  target.searchParams.set("state", state);
  return target.toString();
}
