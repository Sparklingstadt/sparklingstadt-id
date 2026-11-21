import assert from "node:assert/strict";
import test from "node:test";
import { authorizePathWithoutPrompt, parsePrompt } from "../../lib/id/prompt.ts";

test("parsePrompt reads login and none from the prompt values", () => {
  assert.deepEqual(parsePrompt(null), { login: false, none: false, other: false });
  assert.deepEqual(parsePrompt(""), { login: false, none: false, other: false });
  assert.deepEqual(parsePrompt("none"), { login: false, none: true, other: false });
  assert.deepEqual(parsePrompt("login consent"), { login: true, none: false, other: true });
  assert.deepEqual(parsePrompt("none login"), { login: true, none: true, other: true });
  assert.deepEqual(parsePrompt("none consent"), { login: false, none: true, other: true });
  assert.deepEqual(parsePrompt("loginx nonex"), { login: false, none: false, other: true });
});

test("authorizePathWithoutPrompt keeps every other parameter", () => {
  const params = new URLSearchParams({ client_id: "typle-r", prompt: "login", state: "a b" });
  assert.equal(authorizePathWithoutPrompt("/oauth/authorize", params), "/oauth/authorize?client_id=typle-r&state=a+b");
  assert.equal(params.get("prompt"), "login");
});
