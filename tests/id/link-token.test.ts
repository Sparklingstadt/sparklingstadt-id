import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { purposeOf, readToken } from "../../lib/id/link-token.ts";

const SECRET = "s".repeat(32);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const future = () => Math.floor(Date.now() / 1000) + 3600;

function sign(payload: object, { secret = SECRET, alg = "HS256" } = {}) {
  const signed = `${b64({ alg, typ: "JWT" })}.${b64(payload)}`;
  return `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
}

test("readToken accepts a signed, unexpired token", () => {
  assert.equal(readToken(sign({ email: "a@example.com", exp: future() }), SECRET)?.email, "a@example.com");
});

test("readToken refuses a tampered signature, a tampered payload and another secret", () => {
  const token = sign({ email: "a@example.com", exp: future() });
  const [header, , signature] = token.split(".");
  assert.equal(readToken(`${token.slice(0, -2)}AA`, SECRET), null);
  assert.equal(readToken(`${header}.${b64({ email: "b@example.com", exp: future() })}.${signature}`, SECRET), null);
  assert.equal(readToken(sign({ email: "a@example.com", exp: future() }, { secret: "t".repeat(32) }), SECRET), null);
});

test("readToken refuses alg none and other algorithms", () => {
  const payload = { email: "a@example.com", exp: future() };
  assert.equal(readToken(`${b64({ alg: "none" })}.${b64(payload)}.`, SECRET), null);
  assert.equal(readToken(sign(payload, { alg: "none" }), SECRET), null);
  assert.equal(readToken(sign(payload, { alg: "HS512" }), SECRET), null);
});

test("readToken refuses an expired token, one without an expiry and malformed input", () => {
  assert.equal(readToken(sign({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET), null);
  assert.equal(readToken(sign({ email: "a@example.com" }), SECRET), null);
  assert.equal(readToken("", SECRET), null);
  assert.equal(readToken("a.b", SECRET), null);
  assert.equal(readToken("a.b.c", SECRET), null);
});

test("purposeOf tells a verify token from an email change token and refuses mixed or other shapes", () => {
  assert.equal(purposeOf({ email: "a@example.com", userId: "u" }), "verify");
  assert.equal(purposeOf({ updateTo: "b@example.com", requestType: "change-email-verification" }), "change_email");
  // A change token without its request type, or a verify token with one, is neither.
  assert.equal(purposeOf({ updateTo: "b@example.com" }), null);
  assert.equal(purposeOf({ requestType: "change-email-verification" }), null);
  // The first step of Better Auth's two-step flow and the legacy flow are not links this app offers.
  assert.equal(purposeOf({ updateTo: "b@example.com", requestType: "change-email-confirmation" }), null);
  assert.equal(purposeOf({ updateTo: 5, requestType: "change-email-verification" }), null);
});
