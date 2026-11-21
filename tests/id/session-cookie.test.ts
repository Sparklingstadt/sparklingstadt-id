import assert from "node:assert/strict";
import test from "node:test";
import { sessionCookie } from "../../lib/id/session-cookie.ts";

test("production over HTTPS uses the __Host- prefix, which another host of the domain cannot set", () => {
  assert.deepEqual(sessionCookie({ NODE_ENV: "production", ID_ISSUER: "https://id.example" }), {
    name: "__Host-sid_session",
    secure: true,
  });
});

test("a production build served over http (E2E) keeps the plain name: browsers refuse __Host- without Secure", () => {
  assert.deepEqual(sessionCookie({ NODE_ENV: "production", ID_ISSUER: "http://localhost:3000" }), {
    name: "sid_session",
    secure: false,
  });
});

test("development keeps the plain name", () => {
  assert.deepEqual(sessionCookie({ NODE_ENV: "development", ID_ISSUER: "https://id.example" }), {
    name: "sid_session",
    secure: false,
  });
});
