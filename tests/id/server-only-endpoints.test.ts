import assert from "node:assert/strict";
import test from "node:test";
import { isServerOnlyOverHttp, SERVER_ONLY_PATHS } from "../../lib/id/server-only-endpoints.ts";

const request = new Request("http://localhost:3000/api/auth/x", { method: "POST" });

test("an HTTP request for an endpoint the server actions use is refused", () => {
  for (const path of SERVER_ONLY_PATHS) assert.equal(isServerOnlyOverHttp({ path, request }), true, path);
});

test("auth.api calls from the server (no request) pass", () => {
  for (const path of SERVER_ONLY_PATHS) assert.equal(isServerOnlyOverHttp({ path }), false, path);
});

test("the endpoints the browser calls pass over HTTP", () => {
  for (const path of [
    "/sign-in/email",
    "/sign-out",
    "/get-session",
    "/ok",
    "/passkey/generate-authenticate-options",
    "/passkey/verify-authentication",
    "/passkey/generate-register-options",
    "/passkey/verify-registration",
    "/passkey/list-user-passkeys",
    "/passkey/delete-passkey",
    "/two-factor/enable",
    "/two-factor/disable",
    "/two-factor/verify-totp",
    "/two-factor/verify-backup-code",
    "/two-factor/generate-backup-codes",
    "/oauth2/authorize",
    "/oauth2/token",
    "/oauth2/userinfo",
    "/jwks",
  ]) {
    assert.equal(isServerOnlyOverHttp({ path, request }), false, path);
  }
});
