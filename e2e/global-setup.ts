import { execFileSync } from "node:child_process";

/**
 * Registers the test clients (OIDC_CLIENTS from playwright.config.ts) in the database the server reads, with the
 * same script (and importClients) the production database gets them from.
 */
export default function globalSetup() {
  execFileSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/import-clients.ts"],
    { stdio: "inherit", env: process.env },
  );
}
