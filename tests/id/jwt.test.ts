import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  generateSigningJwk,
  loadSigningKey,
  parsePublicKeys,
  signJwt,
  verifyJwt,
} from "../../lib/id/jwt.ts";

const NOW = 1_800_000_000;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function setup() {
  const key = loadSigningKey(generateSigningJwk());
  return { key, pub: [key.publicJwk] };
}

test("sign and verify round trip", () => {
  const { key, pub } = setup();
  const token = signJwt(key, { sub: "u1", exp: NOW + 300 });
  assert.deepEqual(verifyJwt(token, pub, NOW), { sub: "u1", exp: NOW + 300 });
});

test("header carries alg, typ and kid; signature is 64 bytes", () => {
  const { key } = setup();
  const [h, , s] = signJwt(key, { exp: NOW + 1 }).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), {
    alg: "ES256",
    typ: "JWT",
    kid: key.kid,
  });
  assert.equal(Buffer.from(s, "base64url").length, 64);
});

test("kid is the RFC 7638 thumbprint", () => {
  const { key } = setup();
  const { crv, kty, x, y } = key.publicJwk;
  const canonical = JSON.stringify({ crv, kty, x, y });
  assert.equal(key.kid, createHash("sha256").update(canonical).digest("base64url"));
  assert.equal(key.publicJwk.alg, "ES256");
  assert.equal(key.publicJwk.use, "sig");
  assert.equal("d" in key.publicJwk, false);
});

test("expired token is rejected", () => {
  const { key, pub } = setup();
  assert.equal(verifyJwt(signJwt(key, { exp: NOW - 1 }), pub, NOW), null);
  assert.equal(verifyJwt(signJwt(key, { exp: NOW }), pub, NOW), null);
});

test("missing or non-numeric exp is rejected", () => {
  const { key, pub } = setup();
  assert.equal(verifyJwt(signJwt(key, { sub: "a" }), pub, NOW), null);
  assert.equal(verifyJwt(signJwt(key, { exp: "9999999999" }), pub, NOW), null);
});

test("tampered payload is rejected", () => {
  const { key, pub } = setup();
  const [h, p, s] = signJwt(key, { sub: "u1", exp: NOW + 300 }).split(".");
  const forged = b64({ sub: "u2", exp: NOW + 300 });
  assert.notEqual(forged, p);
  assert.equal(verifyJwt(`${h}.${forged}.${s}`, pub, NOW), null);
});

test("another key does not verify", () => {
  const { key } = setup();
  const other = setup();
  assert.equal(verifyJwt(signJwt(key, { exp: NOW + 300 }), other.pub, NOW), null);
  // same kid but different key material
  const spoof = [{ ...other.key.publicJwk, kid: key.kid }];
  assert.equal(verifyJwt(signJwt(key, { exp: NOW + 300 }), spoof, NOW), null);
});

test("alg other than ES256 is rejected", () => {
  const { key, pub } = setup();
  const [, p, s] = signJwt(key, { exp: NOW + 300 }).split(".");
  for (const alg of ["none", "HS256", "es256"]) {
    const h = b64({ alg, typ: "JWT", kid: key.kid });
    assert.equal(verifyJwt(`${h}.${p}.${s}`, pub, NOW), null);
    assert.equal(verifyJwt(`${h}.${p}.`, pub, NOW), null);
  }
});

test("unknown kid is rejected", () => {
  const { key, pub } = setup();
  const [, p, s] = signJwt(key, { exp: NOW + 300 }).split(".");
  const h = b64({ alg: "ES256", typ: "JWT", kid: "nope" });
  assert.equal(verifyJwt(`${h}.${p}.${s}`, pub, NOW), null);
});

test("malformed tokens return null and never throw", () => {
  const { key, pub } = setup();
  const good = signJwt(key, { exp: NOW + 300 });
  const [h, p, s] = good.split(".");
  const cases = [
    "",
    "a",
    "a.b",
    `${good}.x`,
    "!!!.???.***",
    `${h}.${p}.`,
    `${h}.${p}.${s.slice(0, 10)}`,
    `${h}.${p}.${s.slice(0, -1)}!`,
    `${h}.${p}.${s}==`,
    `${h}.${p}.${s.slice(0, 20)}*~${s.slice(22)}`,
    `${h}.${p}=.${s}`,
    `${b64("x").slice(0, 3)}.${p}.${s}`,
    `${Buffer.from("not json").toString("base64url")}.${p}.${s}`,
    `${h}.${Buffer.from("[1]").toString("base64url")}.${s}`,
    `${Buffer.from("null").toString("base64url")}.${p}.${s}`,
  ];
  for (const t of cases) assert.equal(verifyJwt(t, pub, NOW), null, t);
});

test("loadSigningKey requires EC P-256 with d and kid", () => {
  const jwk = JSON.parse(generateSigningJwk());
  assert.equal(jwk.kty, "EC");
  assert.equal(jwk.crv, "P-256");
  assert.ok(jwk.d && jwk.kid);
  assert.throws(() => loadSigningKey("not json"));
  assert.throws(() => loadSigningKey(JSON.stringify({ ...jwk, kid: undefined })));
  assert.throws(() => loadSigningKey(JSON.stringify({ ...jwk, d: undefined })));
  assert.throws(() => loadSigningKey(JSON.stringify({ ...jwk, crv: "P-384" })));
  assert.throws(() => loadSigningKey(JSON.stringify({ ...jwk, kty: "RSA" })));
});

test("generateSigningJwk is single-line JSON", () => {
  assert.equal(generateSigningJwk().includes("\n"), false);
});

test("parsePublicKeys", () => {
  assert.deepEqual(parsePublicKeys(undefined), []);
  assert.deepEqual(parsePublicKeys(""), []);
  const { key } = setup();
  assert.deepEqual(parsePublicKeys(JSON.stringify([key.publicJwk])), [key.publicJwk]);
});

test("signature with non-canonical trailing bits is rejected", () => {
  const { key, pub } = setup();
  const [h, p, s] = signJwt(key, { exp: NOW + 300 }).split(".");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(s[s.length - 1]);
  const alt = alphabet[last ^ 1]; // differs only in unused low bits
  assert.equal(verifyJwt(`${h}.${p}.${s.slice(0, -1)}${alt}`, pub, NOW), null);
});

test("parsePublicKeys strips private material and validates items", () => {
  const priv = JSON.parse(generateSigningJwk());
  const [out] = parsePublicKeys(JSON.stringify([priv]));
  assert.equal("d" in out, false);
  assert.deepEqual(Object.keys(out).sort(), ["alg", "crv", "kid", "kty", "use", "x", "y"]);
  assert.throws(() => parsePublicKeys("[null]"));
  assert.throws(() => parsePublicKeys("[1]"));
  assert.throws(() => parsePublicKeys(JSON.stringify([{ ...priv, crv: "P-384" }])));
  assert.throws(() => parsePublicKeys(JSON.stringify([{ ...priv, kid: undefined }])));
  assert.throws(() => parsePublicKeys("{}"));
});

test("loadSigningKey rejects a kid that is not the thumbprint", () => {
  const jwk = JSON.parse(generateSigningJwk());
  assert.throws(() => loadSigningKey(JSON.stringify({ ...jwk, kid: "other" })));
});
