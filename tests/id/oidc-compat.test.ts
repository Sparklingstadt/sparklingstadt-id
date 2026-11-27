import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  authorizePathWithoutPrompt,
  basicAuthorization,
  isOlderThanMaxAge,
  isS256Challenge,
  localizedPath,
  parsePrompt,
  storedTokenOf,
} from "../../lib/id/oidc-compat.ts";

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
  const withMaxAge = new URLSearchParams({ client_id: "typle-r", max_age: "0", prompt: "login" });
  assert.equal(authorizePathWithoutPrompt("/oauth/authorize", withMaxAge), "/oauth/authorize?client_id=typle-r");
});

test("isOlderThanMaxAge compares the session's age with max_age in seconds", () => {
  const now = Date.parse("2026-11-26T00:10:00Z");
  const created = new Date("2026-11-26T00:00:00Z");
  assert.equal(isOlderThanMaxAge(created, null, now), false);
  assert.equal(isOlderThanMaxAge(created, "600", now), true);
  assert.equal(isOlderThanMaxAge(created, "601", now), false);
  assert.equal(isOlderThanMaxAge(created, "0", now), true);
  assert.equal(isOlderThanMaxAge(created, "-1", now), false);
  assert.equal(isOlderThanMaxAge(created, "ten", now), false);
});

test("localizedPath prefixes every locale but the default, and ignores an unknown cookie", () => {
  assert.equal(localizedPath(undefined, "/login"), "/login");
  assert.equal(localizedPath("ja", "/login"), "/login");
  assert.equal(localizedPath("zh-cn", "/login"), "/zh-cn/login");
  assert.equal(localizedPath("zh-tw", "/account"), "/zh-tw/account");
  assert.equal(localizedPath("../evil", "/login"), "/login");
});

test("isS256Challenge takes a 43-character base64url value only (RFC 7636 appendix B)", () => {
  assert.ok(isS256Challenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
  assert.ok(!isS256Challenge("short"));
  assert.ok(!isS256Challenge(null));
  assert.ok(!isS256Challenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM"));
});

test("storedTokenOf is the plugin's hash: SHA-256 in base64url", () => {
  assert.equal(storedTokenOf("abc"), createHash("sha256").update("abc").digest("base64url"));
  assert.equal(storedTokenOf("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
});

test("basicAuthorization form-encodes both parts before base64 (RFC 6749 §2.3.1)", () => {
  const header = basicAuthorization("a b", "x:y%");
  assert.equal(Buffer.from(header.slice("Basic ".length), "base64").toString(), "a+b:x%3Ay%25");
});
