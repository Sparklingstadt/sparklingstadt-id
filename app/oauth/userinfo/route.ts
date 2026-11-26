import { getOidcConfig } from "@/lib/id/config";
import { verifyJwt } from "@/lib/id/jwt";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

/** RFC 6750 §3: a missing, malformed, expired or forged token. */
function invalidToken(): Response {
  return Response.json(
    { error: "invalid_token" },
    { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": 'Bearer error="invalid_token"' } },
  );
}

export async function GET(request: Request) {
  let config: ReturnType<typeof getOidcConfig>;
  try {
    config = getOidcConfig();
  } catch {
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }

  const match = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!match) return invalidToken();
  const claims = verifyJwt(match[1], config.publicKeys, Math.floor(Date.now() / 1000));
  if (
    !claims ||
    claims.iss !== config.issuer ||
    claims.aud !== `${config.issuer}/oauth/userinfo` ||
    typeof claims.sub !== "string"
  ) {
    return invalidToken();
  }

  // Always the current values, not what the token was issued with.
  const user = await getPrisma().legacyUser.findUnique({ where: { id: claims.sub } });
  if (!user || !user.emailVerifiedAt) return invalidToken();
  return Response.json(
    { sub: user.id, email: user.email, email_verified: true, name: user.displayName },
    { headers: NO_STORE },
  );
}
