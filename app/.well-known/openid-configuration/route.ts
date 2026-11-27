import { auth } from "@/lib/auth";

export const runtime = "nodejs";
// Reads the issuer at request time; never prerender at build.
export const dynamic = "force-dynamic";

/** Advertised for features the provider does not offer here (spec 4.2 使わない機能), or for private_key_jwt. */
const NOT_OFFERED = [
  "registration_endpoint",
  "introspection_endpoint",
  "introspection_endpoint_auth_methods_supported",
  "introspection_endpoint_auth_signing_alg_values_supported",
  "revocation_endpoint",
  "revocation_endpoint_auth_methods_supported",
  "revocation_endpoint_auth_signing_alg_values_supported",
  "token_endpoint_auth_signing_alg_values_supported",
  "dpop_signing_alg_values_supported",
  "backchannel_logout_supported",
  "backchannel_logout_session_supported",
];

/**
 * The plugin's discovery document with the /oauth/* URLs the clients have always used (rewritten to Better Auth in
 * next.config.ts; /oauth/logout is its own Route Handler), and only the features offered here.
 */
export async function GET() {
  const metadata: Record<string, unknown> = { ...(await auth.api.getOpenIdConfig()) };
  for (const key of NOT_OFFERED) delete metadata[key];
  const issuer = String(metadata.issuer);
  return Response.json(
    {
      ...metadata,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      end_session_endpoint: `${issuer}/oauth/logout`,
      jwks_uri: `${issuer}/oauth/jwks`,
      grant_types_supported: ["authorization_code"],
      prompt_values_supported: ["none", "login"],
    },
    { headers: { "Cache-Control": "public, max-age=600" } },
  );
}
