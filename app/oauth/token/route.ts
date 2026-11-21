import { redeemAuthCode } from "@/lib/id/authorization";
import { authenticateClient, parseBasicCredentials } from "@/lib/id/clients";
import { getOidcConfig } from "@/lib/id/config";
import { signJwt } from "@/lib/id/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_TTL_SECONDS = 300;
// Every client gets the same claims (spec §1.6), so the granted scope is fixed.
const SCOPE = "openid email profile";
// RFC 7636 §4.1: 43–128 unreserved characters.
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** RFC 6749 §5.2 error response: invalid_client is 401, everything else 400. */
function tokenError(error: string, status = 400): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (status === 401) headers["WWW-Authenticate"] = 'Basic realm="sparklingstadt-id"';
  return Response.json({ error }, { status, headers });
}

export async function POST(request: Request) {
  let config: ReturnType<typeof getOidcConfig>;
  try {
    config = getOidcConfig();
  } catch {
    return tokenError("server_error", 500);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return tokenError("invalid_request");
  }
  const body = new URLSearchParams(await request.text());
  // RFC 6749 §3.2: parameters must not be repeated.
  for (const key of new Set(body.keys())) {
    if (body.getAll(key).length > 1) return tokenError("invalid_request");
  }

  // Client authentication: client_secret_basic or client_secret_post, never both.
  const authorization = request.headers.get("authorization");
  let clientId: string | null;
  let clientSecret: string | null;
  if (authorization) {
    if (body.has("client_secret")) return tokenError("invalid_request");
    const basic = parseBasicCredentials(authorization);
    if (!basic) return tokenError("invalid_client", 401);
    if (body.has("client_id") && body.get("client_id") !== basic.id) {
      return tokenError("invalid_client", 401);
    }
    ({ id: clientId, secret: clientSecret } = basic);
  } else {
    clientId = body.get("client_id");
    clientSecret = body.get("client_secret");
  }
  const client = authenticateClient(config.clients, clientId, clientSecret);
  if (!client) return tokenError("invalid_client", 401);

  if (body.get("grant_type") !== "authorization_code") {
    return tokenError(body.has("grant_type") ? "unsupported_grant_type" : "invalid_request");
  }
  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const codeVerifier = body.get("code_verifier");
  if (!code || !redirectUri || !codeVerifier || !CODE_VERIFIER.test(codeVerifier)) {
    return tokenError("invalid_request");
  }

  const redeemed = await redeemAuthCode({ code, clientId: client.id, redirectUri, codeVerifier });
  if ("error" in redeemed) return tokenError(redeemed.error);
  const { user, nonce, authTime } = redeemed;

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const idToken = signJwt(config.signingKey, {
    iss: config.issuer,
    sub: user.id,
    aud: client.id,
    iat,
    exp,
    auth_time: Math.floor(authTime.getTime() / 1000),
    ...(nonce !== null ? { nonce } : {}),
    email: user.email,
    email_verified: true,
    name: user.displayName,
  });
  const accessToken = signJwt(config.signingKey, {
    iss: config.issuer,
    sub: user.id,
    aud: `${config.issuer}/oauth/userinfo`,
    client_id: client.id,
    scope: SCOPE,
    iat,
    exp,
  });

  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      id_token: idToken,
      scope: SCOPE,
    },
    { headers: NO_STORE },
  );
}
