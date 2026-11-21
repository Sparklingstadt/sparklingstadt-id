import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

export type PublicJwk = JsonWebKey & { kid: string; alg: "ES256"; use: "sig" };
export type SigningKey = {
  kid: string;
  privateKey: KeyObject;
  publicJwk: PublicJwk;
};

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const B64URL = /^[A-Za-z0-9_-]+$/;

function parseSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// RFC 7638 thumbprint of an EC key: SHA-256 over the canonical member set.
function thumbprint(jwk: { crv?: string; kty?: string; x?: string; y?: string }): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return createHash("sha256").update(canonical).digest("base64url");
}

export function generateSigningJwk(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  return JSON.stringify({
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
    kid: thumbprint(jwk),
  });
}

export function loadSigningKey(jwkJson: string): SigningKey {
  const jwk = JSON.parse(jwkJson) as JsonWebKey & { kid?: unknown };
  if (!isObject(jwk) || jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new Error("Signing key must be an EC P-256 JWK");
  }
  if (typeof jwk.d !== "string" || !jwk.d) {
    throw new Error("Signing key must include the private component d");
  }
  if (typeof jwk.kid !== "string" || !jwk.kid) {
    throw new Error("Signing key must include kid");
  }
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  const pub = createPublicKey(privateKey).export({ format: "jwk" });
  const kid = jwk.kid;
  if (kid !== thumbprint(pub)) {
    throw new Error("Signing key kid does not match the key thumbprint");
  }
  return {
    kid,
    privateKey,
    publicJwk: {
      kty: "EC",
      crv: "P-256",
      x: pub.x,
      y: pub.y,
      kid,
      alg: "ES256",
      use: "sig",
    },
  };
}

export function parsePublicKeys(json: string | undefined): PublicJwk[] {
  if (!json || !json.trim()) return [];
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("Public keys must be a JSON array");
  return parsed.map((item) => {
    if (
      !isObject(item) ||
      item.kty !== "EC" ||
      item.crv !== "P-256" ||
      typeof item.x !== "string" ||
      typeof item.y !== "string" ||
      typeof item.kid !== "string" ||
      !item.kid
    ) {
      throw new Error("Invalid public key: expected an EC P-256 JWK with x, y and kid");
    }
    // Allowlist: never pass through d or any other member.
    return {
      kty: "EC",
      crv: "P-256",
      x: item.x,
      y: item.y,
      kid: item.kid,
      alg: "ES256",
      use: "sig",
    } as PublicJwk;
  });
}

export function signJwt(key: SigningKey, payload: Record<string, unknown>): string {
  const signingInput = `${b64urlJson({ alg: "ES256", typ: "JWT", kid: key.kid })}.${b64urlJson(payload)}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: key.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

export function verifyJwt(
  token: string,
  keys: PublicJwk[],
  now: number,
  options: { checkExpiry?: boolean } = {},
): Record<string, unknown> | null {
  try {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    if (!parts.every((seg) => B64URL.test(seg))) return null;
    const header = parseSegment(h);
    if (!isObject(header) || header.alg !== "ES256") return null;
    if (typeof header.kid !== "string") return null;
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const signature = Buffer.from(s, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== s) return null;
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), {
      key: publicKey,
      dsaEncoding: "ieee-p1363",
    }, signature);
    if (!ok) return null;
    const payload = parseSegment(p);
    if (!isObject(payload)) return null;
    if (options.checkExpiry !== false && (typeof payload.exp !== "number" || !(payload.exp > now))) return null;
    return payload;
  } catch {
    return null;
  }
}
