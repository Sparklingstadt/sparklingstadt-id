import { timingSafeEqual } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";
import { after } from "next/server";
import { accountThrottle } from "@/lib/id/account-throttle";
import { mailHooks } from "@/lib/id/auth-mail";
import { IP_ADDRESS_OPTIONS } from "@/lib/id/client-ip";
import { cancelPendingLinks } from "@/lib/id/email-links";
import { authOptionsFrom } from "@/lib/id/auth-options";
import { credentialDeps, verifyCredential } from "@/lib/id/credential";
import { hashPassword } from "@/lib/password";
import { oidcCompat } from "@/lib/id/oidc-compat";
import { hashToken } from "@/lib/id/tokens";
import { getPrisma } from "@/lib/prisma";
import { resetThrottle } from "@/lib/id/throttle";

/** A client secret is checked against its SHA-256 hex, the form OIDC_CLIENTS has always stored (lib/id/client-import.ts). */
function verifyClientSecret(secret: string, storedHash: string): boolean {
  const actual = Buffer.from(hashToken(secret), "utf8");
  const expected = Buffer.from(storedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// `next build` imports every route module without the runtime environment, so it gets placeholders there
// (the database client connects only on its first query).
const building = process.env.NEXT_PHASE === "phase-production-build";
if (building) process.env.DATABASE_URL ??= "postgresql://build:build@localhost:5432/build";
const { baseURL, secret } = authOptionsFrom(
  building
    ? { ID_ISSUER: "http://localhost:3000", BETTER_AUTH_SECRET: "build-time-placeholder", ...process.env }
    : process.env,
);

export const auth = betterAuth({
  baseURL,
  secret,
  database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
  session: { expiresIn: 30 * 24 * 60 * 60 },
  user: {
    modelName: "user",
    // The new address is confirmed by the mail to it (mailHooks.sendVerificationEmail).
    changeEmail: { enabled: true },
  },
  emailVerification: {
    sendOnSignUp: true,
    // The mailed link is valid for 24 hours, as before.
    expiresIn: 24 * 60 * 60,
    sendVerificationEmail: mailHooks.sendVerificationEmail,
  },
  // Mail goes out after the response, so a known address does not answer more slowly than an unknown one.
  advanced: {
    // Better Auth's own per-IP limit and clientIp (the throttles) read the same header by the same rule; see lib/id/client-ip.ts.
    ipAddress: IP_ADDRESS_OPTIONS,
    backgroundTasks: { handler: (task) => after(task) },
  },
  emailAndPassword: {
    enabled: true,
    // An unconfirmed address can still sign in; the gate comes with the sign-in flow.
    requireEmailVerification: false,
    // The password rules live in checkPassword, not here.
    minPasswordLength: 1,
    maxPasswordLength: 1024,
    // The same scrypt format as the legacy accounts, so their hashes keep working.
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) =>
        verifyCredential(
          hash,
          password,
          credentialDeps(async (old, next) => {
            await getPrisma().account.updateMany({ where: { password: old }, data: { password: next } });
          }),
        ),
    },
    revokeSessionsOnPasswordReset: true,
    // Signing up does not sign in: the sign-up screen is the same for a new and a registered address.
    autoSignIn: false,
    onExistingUserSignUp: mailHooks.onExistingUserSignUp,
    sendResetPassword: mailHooks.sendResetPassword,
    resetPasswordTokenExpiresIn: 60 * 60,
    onPasswordReset: async ({ user }) => {
      // The mail proved the mailbox, and links asked for before must not outlive the old password.
      await getPrisma().user.update({ where: { id: user.id }, data: { emailVerified: true } });
      await cancelPendingLinks(user.id);
      // Whoever holds the mailbox is not locked out by guesses from elsewhere: the per-account login count starts over.
      await resetThrottle(`login:mail:${user.email.toLowerCase()}`);
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    // The per-IP tier for signing in (the browser calls it); the per-address and per-account limits are accountThrottle.
    customRules: { "/sign-in/email": { window: 60, max: 20 } },
  },
  plugins: [
    accountThrottle(),
    // Before oauthProvider, so that its hooks run first (lib/id/oidc-compat.ts).
    oidcCompat(),
    // The ID token's signing key (ES256). The issuer is ID_ISSUER, the same value as baseURL.
    jwt({
      jwks: { keyPairConfig: { alg: "ES256" } },
      jwt: { issuer: baseURL },
      // The session JWT (/token and the set-auth-jwt header) is not offered: the keys sign ID tokens only.
      disableSettingJwtHeader: true,
    }),
    oauthProvider({
      // Never used: lib/id/oidc-compat.ts sends the user to the login page with the authorize URL in `next`, takes
      // out the prompt values that lead to the plugin's own pages, and blocks its signed-query continuations.
      loginPage: "/login",
      consentPage: "/login",
      scopes: ["openid", "email", "profile"],
      grantTypes: ["authorization_code"],
      allowDynamicClientRegistration: false,
      // Clients are registered only from OIDC_CLIENTS (lib/id/client-import.ts), never by a signed-in user.
      clientPrivileges: () => false,
      resourcePrivileges: () => false,
      // The registered addresses are matched exactly; as before, a registered http address is allowed.
      allowInsecureRedirectUri: () => true,
      storeClientSecret: { hash: hashToken, verify: verifyClientSecret },
      idTokenExpiresIn: 300,
      accessTokenExpiresIn: 300,
      codeExpiresIn: 300,
      // The clients read email and name from the ID token (the plugin puts them in userinfo only).
      customIdTokenClaims: ({ user, scopes }) => ({
        ...(scopes.includes("email") ? { email: user.email, email_verified: user.emailVerified } : {}),
        ...(scopes.includes("profile") ? { name: user.name } : {}),
      }),
      advertisedMetadata: {
        claims_supported: ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "email", "email_verified", "name"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      },
    }),
    // nextCookies must stay last: it lets Server Actions write the cookies Better Auth sets.
    nextCookies(),
  ],
});
