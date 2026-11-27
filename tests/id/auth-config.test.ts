import assert from "node:assert/strict";
import test from "node:test";
import { authOptionsFrom } from "../../lib/id/auth-options.ts";

const SECRET = "x".repeat(32);

test("authOptionsFrom takes the issuer without its trailing slash and the secret", () => {
  assert.deepEqual(authOptionsFrom({ ID_ISSUER: "https://id.example.com/", BETTER_AUTH_SECRET: SECRET }), {
    baseURL: "https://id.example.com",
    secret: SECRET,
  });
});

test("authOptionsFrom names a missing variable without any value", () => {
  assert.throws(() => authOptionsFrom({ ID_ISSUER: "https://id.example.com" }), /BETTER_AUTH_SECRET: is not set/);
  assert.throws(() => authOptionsFrom({ BETTER_AUTH_SECRET: SECRET }), /ID_ISSUER: is not set/);
  assert.throws(
    () => authOptionsFrom({ ID_ISSUER: "https://id.example.com" }),
    (error: unknown) => error instanceof Error && !error.message.includes("https://"),
  );
});
