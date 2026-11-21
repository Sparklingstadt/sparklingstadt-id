import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";
import { hashPassword, needsRehash, verifyPassword } from "../lib/password.ts";

const PASSWORD = "  twelve chars  ";

/** A hash in the stored format with the parameters used before the cost was raised (N=2^14, r=8, p=1). */
function earlierHash(password: string): string {
  const salt = Buffer.alloc(16, 7);
  const key = scryptSync(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 });
  return ["scrypt", 16384, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

test("hashPassword stores N=2^16, r=8, p=2", async () => {
  assert.match(await hashPassword(PASSWORD), /^scrypt\$65536\$8\$2\$/);
});

test("verifyPassword accepts the password it hashed and rejects another", async () => {
  const hash = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword("another password", hash), false);
});

test("verifyPassword still accepts a hash made with the earlier parameters", async () => {
  const hash = earlierHash(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword("another password", hash), false);
});

test("needsRehash is true only for a hash made with other parameters", async () => {
  assert.equal(needsRehash(earlierHash(PASSWORD)), true);
  assert.equal(needsRehash(await hashPassword(PASSWORD)), false);
});
