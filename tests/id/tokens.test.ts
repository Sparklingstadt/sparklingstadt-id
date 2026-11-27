import assert from "node:assert/strict";
import test from "node:test";
import { hashToken, newToken } from "../../lib/id/tokens.ts";

test("tokens", () => {
  assert.match(newToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken(), newToken());
  assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
