import assert from "node:assert/strict";
import test from "node:test";
import { verifyCredential } from "../../lib/id/credential.ts";

function deps(options: { valid: boolean; outdated: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      verify: async (_password: string, hash: string) => {
        calls.push(`verify:${hash}`);
        return hash === "stored" && options.valid;
      },
      needsRehash: (hash: string) => options.outdated && hash === "stored",
      hash: async () => "fresh",
      replace: async (old: string, next: string) => {
        calls.push(`replace:${old}->${next}`);
      },
    },
  };
}

test("a wrong password against an outdated hash also checks the current-parameter dummy", async () => {
  const { calls, deps: d } = deps({ valid: false, outdated: true });
  assert.equal(await verifyCredential("stored", "pw", d, async () => "dummy"), false);
  assert.deepEqual(calls, ["verify:stored", "verify:dummy"]);
});

test("a right password against an outdated hash stores the current-parameter hash", async () => {
  const { calls, deps: d } = deps({ valid: true, outdated: true });
  assert.equal(await verifyCredential("stored", "pw", d, async () => "dummy"), true);
  assert.deepEqual(calls, ["verify:stored", "replace:stored->fresh"]);
});

test("a current hash needs no extra work, right or wrong", async () => {
  for (const valid of [true, false]) {
    const { calls, deps: d } = deps({ valid, outdated: false });
    assert.equal(await verifyCredential("stored", "pw", d, async () => "dummy"), valid);
    assert.deepEqual(calls, ["verify:stored"]);
  }
});
