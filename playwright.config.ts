import { createHash } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { generateSigningJwk } from "./lib/id/jwt.ts";

// `docker compose up -d --wait` and `pnpm prisma migrate deploy` first (compose.yaml, port 55432).
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55432/sparklingstadt_id";
const mailLog = process.env.MAIL_LOG ?? "/tmp/sparklingstadt-id-mail.jsonl";
// Test-only client; its secret is "e2e-secret".
const oidcClients =
  process.env.OIDC_CLIENTS ??
  JSON.stringify([
    {
      id: "e2e-client",
      name: "e2e-client",
      secretHash: createHash("sha256").update("e2e-secret").digest("hex"),
      redirectUris: ["http://localhost:3000/e2e-callback"],
      postLogoutRedirectUris: ["http://localhost:3000/e2e-signed-out"],
    },
    // A second client for the SSO test; its secret is "client-b-secret".
    {
      id: "client-b",
      name: "client-b",
      secretHash: createHash("sha256").update("client-b-secret").digest("hex"),
      redirectUris: ["http://localhost:3000/client-b-callback"],
      postLogoutRedirectUris: ["http://localhost:3000/client-b-signed-out"],
    },
  ]);

// The mail helpers (e2e/helpers/mail-log.ts) read the same file the server writes.
process.env.MAIL_LOG = mailLog;
// The server signs its mail links with this secret; tests that need an expired link sign one themselves.
process.env.BETTER_AUTH_SECRET ??= "e2e-better-auth-secret-0123456789abcdef";
// Tests sign their own tokens (an expired access token cannot be waited for), so the workers get the server's key.
process.env.OIDC_SIGNING_KEY ??= generateSigningJwk();

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    timeout: 120_000,
    command: "pnpm run start --hostname localhost --port 3000",
    // The login page needs no session; the root redirects.
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      ID_ISSUER: "http://localhost:3000",
      MAIL_LOG: mailLog,
      OIDC_CLIENTS: oidcClients,
      OIDC_SIGNING_KEY: process.env.OIDC_SIGNING_KEY,
    },
  },
});
