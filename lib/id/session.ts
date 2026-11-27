import { cache } from "react";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";

export type CurrentUser = {
  user: { id: string; email: string; name: string; emailVerified: boolean; twoFactorEnabled: boolean };
  session: { id: string; createdAt: Date };
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // A Server Action that sets the cookie (a password change signs this browser in again) re-renders the page in the
  // same request: read the cookies from the store, which already holds the new one, not from the request's headers.
  const requestHeaders = new Headers(await headers());
  requestHeaders.set("cookie", (await cookies()).toString());
  const found = await auth.api.getSession({ headers: requestHeaders });
  if (!found) return null;
  const { user, session } = found;
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled === true,
    },
    session: { id: session.id, createdAt: session.createdAt },
  };
});

/** Ends the browser's session and removes its cookie. Call only from a Server Action or Route Handler. */
export async function destroySession(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
}
