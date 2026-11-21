import { createHash } from "node:crypto";

export function isS256Challenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
