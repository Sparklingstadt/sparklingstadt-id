import assert from "node:assert/strict";
import test from "node:test";
import { GENERATE_PATH, passkeyGrantIdentifier, passkeyPasswordGate, VERIFY_PATH } from "../../lib/id/passkey-grant.ts";

test("the grant is named after the session", () => {
  assert.equal(passkeyGrantIdentifier("abc"), "passkey-add:abc");
});

test("the gate covers both registration endpoints and nothing else", () => {
  const hook = passkeyPasswordGate().hooks?.before?.[0];
  assert.ok(hook);
  assert.equal(hook.matcher({ path: GENERATE_PATH } as never), true);
  assert.equal(hook.matcher({ path: VERIFY_PATH } as never), true);
  for (const path of ["/passkey/delete-passkey", "/passkey/update-passkey", "/passkey/list-user-passkeys", "/passkey/verify-authentication"]) {
    assert.equal(hook.matcher({ path } as never), false, path);
  }
});
