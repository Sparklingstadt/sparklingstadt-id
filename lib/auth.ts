import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { authOptionsFrom } from "@/lib/id/auth-options";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getPrisma } from "@/lib/prisma";

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
  user: { modelName: "user" },
  emailAndPassword: {
    enabled: true,
    // An unconfirmed address can still sign in; the gate comes with the sign-in flow.
    requireEmailVerification: false,
    // The password rules live in checkPassword, not here.
    minPasswordLength: 1,
    maxPasswordLength: 1024,
    // The same scrypt format as the legacy accounts, so their hashes keep working.
    password: { hash: hashPassword, verify: ({ hash, password }) => verifyPassword(password, hash) },
    revokeSessionsOnPasswordReset: true,
  },
  rateLimit: { enabled: true, storage: "database" },
  // nextCookies must stay last: it lets Server Actions write the cookies Better Auth sets.
  plugins: [nextCookies()],
});
