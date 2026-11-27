import { execFileSync, spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("the client import refuses to run when a value is not set explicitly (it never reads .env.local)", () => {
  const env = { ...process.env };
  delete env.OIDC_CLIENTS;
  let stderr = "";
  try {
    execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/import-clients.ts"], {
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    stderr = String((error as { stderr?: string }).stderr);
  }
  expect(stderr).toContain("Set OIDC_CLIENTS explicitly");
});

test("the client import names where each value came from, never the value", () => {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/import-clients.ts"],
    { env: process.env, encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toContain("DATABASE_URL: from shell");
  expect(result.stderr).toContain("OIDC_CLIENTS: from shell");
  expect(result.stderr).not.toContain(process.env.OIDC_CLIENTS as string);
  expect(result.stderr).not.toContain("postgres:postgres");
  expect(result.stdout).toMatch(/^oauthClient: \d+ created, \d+ updated$/m);
});
