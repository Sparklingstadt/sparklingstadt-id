import { createHmac, timingSafeEqual } from "node:crypto";

export type EmailLinkPurpose = "verify" | "change_email";

export type Payload = { email?: unknown; updateTo?: unknown; requestType?: unknown; userId?: unknown; exp?: unknown };

/**
 * Reads a token Better Auth mailed (an HS256 JWT) without using it. Null when the signature or the
 * lifetime is wrong. The page needs this to decide what to offer: only a POST may confirm.
 */
export function readToken(token: string, secret: string): Payload | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  try {
    if ((JSON.parse(Buffer.from(header, "base64url").toString()) as { alg?: unknown }).alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** What a signed payload asks for: a plain verify token, or the email change one; anything else (other request types, mixed shapes) is refused. */
export function purposeOf(payload: Payload): EmailLinkPurpose | null {
  if (payload.updateTo === undefined) return payload.requestType === undefined ? "verify" : null;
  return payload.requestType === "change-email-verification" && typeof payload.updateTo === "string" ? "change_email" : null;
}

