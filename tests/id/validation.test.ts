import assert from "node:assert/strict";
import test from "node:test";
import {
  ValidationError,
  checkPassword,
  normalizeDisplayName,
  normalizeEmail,
  safeNextPath,
} from "../../lib/id/validation.ts";

test("normalizeEmail trims and lowercases", () => assert.equal(normalizeEmail(" Foo@Example.com "), "foo@example.com"));
test("normalizeEmail rejects", () => {
  for (const bad of ["", "foo", "@x", "x@", `${"a".repeat(250)}@b.cd`]) assert.throws(() => normalizeEmail(bad), ValidationError);
});
test("normalizeEmail rejects anything but one plain mailbox", () => {
  const bad = [
    "a@x.com,b@y.com",
    "a@b@x.com",
    "a;b@x.com",
    "<a@x.com>",
    '"a"@x.com',
    "a@x",
    "a@x..com",
    "a@-x.com",
    "a@x.com.",
    "a\u0000@x.com",
  ];
  for (const value of bad) assert.throws(() => normalizeEmail(value), ValidationError, value);
});
test("normalizeEmail accepts plus tags, subdomains and non-ASCII addresses", () => {
  for (const ok of ["foo.bar+tag@mail.example.co.jp", "a_b-c@x-y.example", "用户@例子.测试"]) {
    assert.equal(normalizeEmail(ok), ok);
  }
});
test("normalizeDisplayName", () => {
  assert.equal(normalizeDisplayName("  ふわふわ  "), "ふわふわ");
  for (const bad of ["", "   ", "a".repeat(51), "a\0b"]) assert.throws(() => normalizeDisplayName(bad), ValidationError);
});
test("checkPassword keeps spaces", () => {
  assert.equal(checkPassword("  twelve chars  "), "  twelve chars  ");
  assert.throws(() => checkPassword("a".repeat(11)), ValidationError);
  assert.throws(() => checkPassword("a".repeat(129)), ValidationError);
});
test("safeNextPath", () => {
  const authorize = "/oauth/authorize?client_id=typle-r&redirect_uri=https%3A%2F%2Fx%2Fcb&state=s&scope=openid%20email";
  assert.equal(safeNextPath(authorize, "/account"), authorize);
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "", null, "/" + "a".repeat(4096)])
    assert.equal(safeNextPath(bad, "/account"), "/account");
});
