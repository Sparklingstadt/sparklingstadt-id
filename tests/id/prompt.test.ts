import assert from "node:assert/strict";
import test from "node:test";
import { authorizePathWithoutPrompt, wantsLogin } from "../../lib/id/prompt.ts";

test("wantsLogin finds login among the prompt values", () => {
  assert.equal(wantsLogin("login"), true);
  assert.equal(wantsLogin("consent login"), true);
  for (const other of [null, "", "none", "consent", "loginx"]) assert.equal(wantsLogin(other), false);
});

test("authorizePathWithoutPrompt keeps every other parameter", () => {
  const params = new URLSearchParams({ client_id: "typle-r", prompt: "login", state: "a b" });
  assert.equal(authorizePathWithoutPrompt("/oauth/authorize", params), "/oauth/authorize?client_id=typle-r&state=a+b");
  assert.equal(params.get("prompt"), "login");
});
