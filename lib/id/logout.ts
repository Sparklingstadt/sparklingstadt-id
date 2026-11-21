import { findClient } from "./clients.ts";
import type { OidcConfig } from "./config.ts";
import { verifyJwt } from "./jwt.ts";

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
    const claims = verifyJwt(hint, config.publicKeys, 0, { checkExpiry: false });
    if (!claims || claims.iss !== config.issuer) return null;
    const { aud } = claims;
    audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud.filter((a): a is string => typeof a === "string") : [];
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
