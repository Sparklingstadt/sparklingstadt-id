import { hashToken, newToken } from "../lib/id/tokens.ts";

const id = process.argv[2];
if (!id) {
  console.error("Usage: pnpm run oidc:client <client-id>");
  process.exit(1);
}

const secret = newToken();
console.log(`secret=${secret}`);
console.log(
  JSON.stringify({ id, name: id, secretHash: hashToken(secret), redirectUris: [], postLogoutRedirectUris: [] }),
);
