import { getOidcConfig } from "@/lib/id/config";

export const runtime = "nodejs";
// Reads env at request time; never prerender at build.
export const dynamic = "force-dynamic";

export async function GET() {
  let issuer: string;
  try {
    ({ issuer } = getOidcConfig());
  } catch {
    return Response.json(
      { error: "server_error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      jwks_uri: `${issuer}/oauth/jwks`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
      scopes_supported: ["openid", "email", "profile"],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
      ],
      code_challenge_methods_supported: ["S256"],
      prompt_values_supported: ["none", "login"],
      claims_supported: [
        "sub",
        "iss",
        "aud",
        "exp",
        "iat",
        "auth_time",
        "nonce",
        "email",
        "email_verified",
        "name",
      ],
    },
    { headers: { "Cache-Control": "public, max-age=600" } },
  );
}
