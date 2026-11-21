import { parseClients, type OidcClient } from "./clients.ts";
import { loadSigningKey, parsePublicKeys, type SigningKey } from "./jwt.ts";

export type OidcConfig = {
  issuer: string;
  signingKey: SigningKey;
  publicKeys: SigningKey["publicJwk"][];
  clients: OidcClient[];
};

let cached: OidcConfig | undefined;

export function getOidcConfig(): OidcConfig {
  if (cached) return cached;
  const issuer = process.env.ID_ISSUER?.trim().replace(/\/+$/, "");
  const signingKeyJson = process.env.OIDC_SIGNING_KEY?.trim();
  const missing: string[] = [];
  if (!issuer) missing.push("ID_ISSUER");
  if (!signingKeyJson) missing.push("OIDC_SIGNING_KEY");
  if (missing.length > 0 || !issuer || !signingKeyJson) {
    throw new Error(`Sparklingstadt ID is not configured: missing ${missing.join(", ")}`);
  }
  const signingKey = loadSigningKey(signingKeyJson);
  cached = {
    issuer,
    signingKey,
    publicKeys: [
      signingKey.publicJwk,
      ...parsePublicKeys(process.env.OIDC_PREVIOUS_PUBLIC_KEYS).filter(
        (key) => key.kid !== signingKey.kid,
      ),
    ],
    clients: parseClients(process.env.OIDC_CLIENTS),
  };
  return cached;
}
