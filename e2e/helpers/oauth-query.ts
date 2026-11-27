import { makeSignature } from "better-auth/crypto";

/**
 * An oauth_query signed exactly as the oauth-provider plugin signs one when it sends the user to its own login page
 * (signParams in @better-auth/oauth-provider 1.7.28): `exp` and `ba_iat` added, every parameter name listed in
 * `ba_param`, the parameters sorted by name then value, HMAC-SHA-256 with BETTER_AUTH_SECRET (makeSignature), `sig`
 * appended. The plugin would accept it as its own; only lib/id/oidc-compat.ts refuses it.
 */
export async function signedOAuthQuery(params: URLSearchParams, secret = process.env.BETTER_AUTH_SECRET ?? ""): Promise<string> {
  const query = new URLSearchParams(params);
  const issuedAt = Date.now();
  query.set("exp", String(Math.floor(issuedAt / 1000) + 300));
  query.set("ba_iat", String(issuedAt));
  query.delete("sig");
  query.delete("ba_param");
  for (const name of [...new Set([...query.keys(), "ba_param"])].sort()) query.append("ba_param", name);
  const canonical = new URLSearchParams(
    [...query.entries()].sort(([keyA, valueA], [keyB, valueB]) =>
      keyA < keyB ? -1 : keyA > keyB ? 1 : valueA < valueB ? -1 : valueA > valueB ? 1 : 0,
    ),
  );
  query.set("sig", await makeSignature(canonical.toString(), secret));
  return query.toString();
}
