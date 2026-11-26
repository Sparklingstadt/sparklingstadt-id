import assert from "node:assert/strict";
import test from "node:test";
import { consumeRules, resetRules, throttleRules, type ThrottleStore } from "../../lib/id/account-throttle.ts";

function memoryStore() {
  const counts = new Map<string, number>();
  const store: ThrottleStore = {
    async consume(key, limit) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next <= limit;
    },
    async reset(key) {
      counts.delete(key);
    },
  };
  return { store, counts };
}

const info = { email: "a@example.com", rawEmail: "a@example.com", ip: "203.0.113.5" };

test("login by one address and IP passes 5 times and is throttled the 6th", async () => {
  const { store } = memoryStore();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await consumeRules("/sign-in/email", info, store), true);
  }
  assert.equal(await consumeRules("/sign-in/email", info, store), false);
  // Another IP has its own 5 for the same address.
  assert.equal(await consumeRules("/sign-in/email", { ...info, ip: "203.0.113.6" }, store), true);
});

test("a successful login resets the address+IP count but not the per-account count", async () => {
  const { store, counts } = memoryStore();
  for (let attempt = 0; attempt < 3; attempt += 1) await consumeRules("/sign-in/email", info, store);
  await resetRules("/sign-in/email", info, store);
  assert.equal(counts.has("login:ipmail:203.0.113.5:a@example.com"), false);
  assert.equal(counts.get("login:mail:a@example.com"), 3);
  assert.equal(counts.get("login:ip:203.0.113.5"), 3);
});

test("the per-account limit is 30 across every IP", async () => {
  const { store } = memoryStore();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assert.equal(await consumeRules("/sign-in/email", { ...info, ip: `198.51.100.${attempt}` }, store), true);
  }
  assert.equal(await consumeRules("/sign-in/email", { ...info, ip: "198.51.100.99" }, store), false);
});

test("an invalid address still counts per IP, and has no account key", async () => {
  const { store, counts } = memoryStore();
  await consumeRules("/sign-in/email", { rawEmail: "not-an-address", ip: "203.0.113.5" }, store);
  assert.deepEqual([...counts.keys()].sort(), ["login:ip:203.0.113.5", "login:ipmail:203.0.113.5:not-an-address"]);
});

test("sign-up, resend, email change and reset are 10 per IP", async () => {
  for (const [path, key] of [
    ["/sign-up/email", "signup:ip:203.0.113.5"],
    ["/send-verification-email", "resend:ip:203.0.113.5"],
    ["/change-email", "emailchange:ip:203.0.113.5"],
    ["/request-password-reset", "reset:ip:203.0.113.5"],
  ] as const) {
    const { store, counts } = memoryStore();
    for (let attempt = 0; attempt < 10; attempt += 1) assert.equal(await consumeRules(path, info, store), true, path);
    assert.equal(await consumeRules(path, info, store), false, path);
    assert.deepEqual([...counts.keys()], [key]);
  }
});

test("password confirmation is 5 per user across change-password and verify-password, and resets on success", async () => {
  const { store, counts } = memoryStore();
  const user = { ...info, userId: "u1" };
  for (let attempt = 0; attempt < 3; attempt += 1) await consumeRules("/change-password", user, store);
  for (let attempt = 0; attempt < 2; attempt += 1) assert.equal(await consumeRules("/verify-password", user, store), true);
  assert.equal(await consumeRules("/verify-password", user, store), false);
  await resetRules("/change-password", user, store);
  assert.equal(counts.has("pwcheck:user:u1"), false);
});

test("password confirmation without a session counts nothing", async () => {
  const { store, counts } = memoryStore();
  assert.equal(await consumeRules("/change-password", info, store), true);
  assert.equal(counts.size, 0);
});

test("every rule path is listed once and other paths are not throttled", async () => {
  const paths = throttleRules.map((rule) => rule.path);
  assert.equal(new Set(paths).size, paths.length);
  const { store, counts } = memoryStore();
  assert.equal(await consumeRules("/get-session", info, store), true);
  assert.equal(counts.size, 0);
});
