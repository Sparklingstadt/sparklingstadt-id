import { parseClients, type OidcClient } from "./clients.ts";
import { loadSigningKey, parsePublicKeys, type SigningKey } from "./jwt.ts";

export type OidcConfig = {
  issuer: string;
  signingKey: SigningKey;
  publicKeys: SigningKey["publicJwk"][];
  clients: OidcClient[];
};

type OidcEnv = Record<string, string | undefined>;

/**
 * A configuration problem, named by its variable. The message never holds the value: the signing key
 * is a secret, and JSON.parse puts the start of its input into a SyntaxError's message.
 */
export class OidcConfigError extends Error {
  constructor(variable: string, problem: string) {
    super(`${variable}: ${problem}`);
    this.name = "OidcConfigError";
  }
}

function read<T>(variable: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof SyntaxError) throw new OidcConfigError(variable, "is not valid JSON");
    // Our own checks and node:crypto describe the shape of the input, not its content.
    throw new OidcConfigError(variable, error instanceof Error ? error.message : "could not be read");
  }
}

/** Builds the configuration from `env`, or throws an OidcConfigError that is safe to log. */
export function loadOidcConfig(env: OidcEnv): OidcConfig {
  const issuer = env.ID_ISSUER?.trim().replace(/\/+$/, "");
  const signingKeyJson = env.OIDC_SIGNING_KEY?.trim();
  if (!issuer) throw new OidcConfigError("ID_ISSUER", "is not set");
  if (!signingKeyJson) throw new OidcConfigError("OIDC_SIGNING_KEY", "is not set");

  const signingKey = read("OIDC_SIGNING_KEY", () => loadSigningKey(signingKeyJson));
  const previousKeys = read("OIDC_PREVIOUS_PUBLIC_KEYS", () => parsePublicKeys(env.OIDC_PREVIOUS_PUBLIC_KEYS));
  const clients = read("OIDC_CLIENTS", () => parseClients(env.OIDC_CLIENTS));
  return {
    issuer,
    signingKey,
    publicKeys: [signingKey.publicJwk, ...previousKeys.filter((key) => key.kid !== signingKey.kid)],
    clients,
  };
}

let cached: OidcConfig | undefined;
let lastLogged: string | undefined;

/**
 * The configuration from process.env, read once. A bad configuration throws, and the routes answer
 * server_error; the reason is logged here (once per instance and reason) so it shows in the runtime logs.
 */
export function getOidcConfig(): OidcConfig {
  if (cached) return cached;
  try {
    cached = loadOidcConfig(process.env);
  } catch (error) {
    const reason = error instanceof OidcConfigError ? error.message : "unexpected error while reading the configuration";
    if (reason !== lastLogged) {
      lastLogged = reason;
      console.error(`[id] Sparklingstadt ID is not configured correctly: ${reason}`);
    }
    throw error instanceof OidcConfigError ? error : new Error(reason);
  }
  return cached;
}
