import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { after } from "next/server";
import { accountThrottle } from "@/lib/id/account-throttle";
import { mailHooks } from "@/lib/id/auth-mail";
import { cancelPendingLinks } from "@/lib/id/email-links";
import { authOptionsFrom } from "@/lib/id/auth-options";
import { credentialDeps, verifyCredential } from "@/lib/id/credential";
import { hashPassword } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";
import { resetThrottle } from "@/lib/id/throttle";

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
    // Better Auth's own per-IP limit reads the same header as clientIp (lib/id/client-ip.ts): Vercel sets
    // x-forwarded-for to the single client address and drops what the client sent.
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
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
  // nextCookies must stay last: it lets Server Actions write the cookies Better Auth sets.
  plugins: [accountThrottle(), nextCookies()],
});
