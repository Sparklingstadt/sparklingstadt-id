import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text.toUpperCase().replace(/=+$/, "")) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** The base32 secret of an otpauth:// URI. */
export function secretOf(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) throw new Error("no secret in the URI");
  return secret;
}

/** RFC 6238 TOTP: HMAC-SHA-1, 6 digits, 30 second steps. `secret` is base32; `at` is milliseconds (default: now). */
export function totp(secret: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** A 6-digit code that is none of the codes accepted around `at` (the step before, the step, the step after). */
export function wrongTotp(secret: string, at: number = Date.now()): string {
  const accepted = new Set([-30_000, 0, 30_000].map((shift) => totp(secret, at + shift)));
  for (let n = 0; ; n += 1) {
    const candidate = n.toString().padStart(6, "0");
    if (!accepted.has(candidate)) return candidate;
  }
}
