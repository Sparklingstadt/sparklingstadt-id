import { createHash, generateKeyPairSync } from "node:crypto";

/**
 * A fresh ES256 private JWK in the format OIDC_SIGNING_KEY used to have (kid = RFC 7638 thumbprint), for the
 * legacy-import test: the import script puts it into Better Auth's key table with the same kid.
 */
export function generateSigningJwk(): string {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return JSON.stringify({
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
    kid: createHash("sha256").update(canonical).digest("base64url"),
  });
}
