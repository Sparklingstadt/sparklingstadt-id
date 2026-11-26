/** The two values Better Auth needs from the environment. A missing one names the variable, never a value. */
export function authOptionsFrom(env: Record<string, string | undefined>): { baseURL: string; secret: string } {
  const issuer = env.ID_ISSUER?.trim().replace(/\/+$/, "");
  if (!issuer) throw new Error("ID_ISSUER: is not set");
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET: is not set");
  return { baseURL: issuer, secret };
}
