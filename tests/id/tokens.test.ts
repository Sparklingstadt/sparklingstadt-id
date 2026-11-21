import assert from "node:assert/strict";
import test from "node:test";
import { isS256Challenge, s256 } from "../../lib/id/pkce.ts";
import { hashToken, newToken } from "../../lib/id/tokens.ts";

test("tokens", () => {
  assert.match(newToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken(), newToken());
  assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("s256 matches RFC 7636 appendix B", () => {
  assert.equal(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.ok(isS256Challenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
  assert.ok(!isS256Challenge("short"));
});
