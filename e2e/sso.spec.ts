import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { newEmail, PASSWORD, signUp } from "./helpers/account";
import { lastMailTo } from "./helpers/mail-log";
import { confirmEmailLink } from "./helpers/verify";

const ISSUER = "http://localhost:3000";

test.use({
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": `e2e-${randomUUID()}` });
  },
});

type Client = { id: string; secret: string; redirectUri: string };
const CLIENT_A: Client = { id: "e2e-client", secret: "e2e-secret", redirectUri: `${ISSUER}/e2e-callback` };
const CLIENT_B: Client = { id: "client-b", secret: "client-b-secret", redirectUri: `${ISSUER}/client-b-callback` };

function authorizeRequest(client: Client) {
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: `state-${randomUUID()}`,
    nonce: `nonce-${randomUUID()}`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return { verifier, params, path: `/oauth/authorize?${params}` };
}

async function exchange(request: APIRequestContext, client: Client, code: string, verifier: string) {
  const response = await request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: client.redirectUri,
      code_verifier: verifier,
      client_id: client.id,
      client_secret: client.secret,
    },
  });
  expect(response.status()).toBe(200);
  const { id_token: idToken } = await response.json();
  return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
}

test("one login serves two clients and yields the same sub", async ({ page, request }) => {
  const email = newEmail();
  await signUp(page, email);
  await confirmEmailLink(page, (await lastMailTo(email, "verify")).link, { email, password: PASSWORD });
  await page.context().clearCookies();

  // Client A: signed out, so log in once.
  const a = authorizeRequest(CLIENT_A);
  await page.goto(a.path);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.waitForURL((url) => url.href.startsWith(`${CLIENT_A.redirectUri}?`));
  const codeA = new URL(page.url()).searchParams.get("code") as string;
  expect(codeA).toMatch(/^[\w-]{43}$/);

  // Client B in the same browser: back with a code, never showing the login page.
  const visited: string[] = [];
  page.on("framenavigated", (frame) => visited.push(new URL(frame.url()).pathname));
  const b = authorizeRequest(CLIENT_B);
  await page.goto(b.path);
  await page.waitForURL((url) => url.href.startsWith(`${CLIENT_B.redirectUri}?`));
  expect(visited.some((path) => path.endsWith("/login"))).toBe(false);
  const callbackB = new URL(page.url());
  expect(callbackB.searchParams.get("state")).toBe(b.params.get("state"));
  const codeB = callbackB.searchParams.get("code") as string;
  expect(codeB).toMatch(/^[\w-]{43}$/);

  const idTokenA = await exchange(request, CLIENT_A, codeA, a.verifier);
  const idTokenB = await exchange(request, CLIENT_B, codeB, b.verifier);
  expect(idTokenA.aud).toBe(CLIENT_A.id);
  expect(idTokenB.aud).toBe(CLIENT_B.id);
  expect(idTokenB.nonce).toBe(b.params.get("nonce"));
  expect(idTokenB.sub).toBe(idTokenA.sub);
  expect(idTokenB.email).toBe(email);
});
