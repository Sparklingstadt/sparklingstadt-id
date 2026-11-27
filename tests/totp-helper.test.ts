import assert from "node:assert/strict";
import test from "node:test";
import { secretOf, totp, wrongTotp } from "../e2e/helpers/totp.ts";

// RFC 6238 Appendix B (SHA-1), last 6 digits; the secret is "12345678901234567890" in base32.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("totp matches the RFC 6238 SHA-1 vectors", () => {
  assert.equal(totp(SECRET, 59_000), "287082");
  assert.equal(totp(SECRET, 1_111_111_109_000), "081804");
  assert.equal(totp(SECRET, 2_000_000_000_000), "279037");
});

test("secretOf reads the secret of an otpauth URI and wrongTotp is never accepted", () => {
  assert.equal(secretOf(`otpauth://totp/Sparklingstadt%20ID:a%40example.com?secret=${SECRET}&issuer=Sparklingstadt%20ID`), SECRET);
  const wrong = wrongTotp(SECRET, 59_000);
  assert.ok(![29_000, 59_000, 89_000].map((at) => totp(SECRET, at)).includes(wrong));
});
