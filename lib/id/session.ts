import { cache } from "react";
import { cookies } from "next/headers";
import type { Session, User, Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { sessionCookie } from "./session-cookie.ts";
import { hashToken, newToken } from "./tokens.ts";

const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Sets the session cookie; `maxAge` 0 removes it. */
async function writeSessionCookie(value: string, maxAge: number): Promise<void> {
  const { name, secure } = sessionCookie(process.env);
  (await cookies()).set(name, value, { httpOnly: true, sameSite: "lax", path: "/", maxAge, secure });
}

/** Call only from a Server Action or Route Handler (writes a cookie). */
export async function createSession(userId: string, sessionVersion: number): Promise<void> {
  const token = newToken();
  await getPrisma().session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      sessionVersion,
      expiresAt: new Date(Date.now() + MAX_AGE_SECONDS * 1000),
    },
  });
  await writeSessionCookie(token, MAX_AGE_SECONDS);
}

export const getCurrentUser = cache(
  async (): Promise<{ user: User; session: Session } | null> => {
    const token = (await cookies()).get(sessionCookie(process.env).name)?.value;
    if (!token) return null;
    const session = await getPrisma().session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    const { user, ...row } = session;
    if (row.expiresAt.getTime() <= Date.now() || row.sessionVersion !== user.sessionVersion) return null;
    return { user, session: row };
  },
);

/** Call only from a Server Action or Route Handler (deletes a cookie). */
export async function destroySession(): Promise<void> {
  const token = (await cookies()).get(sessionCookie(process.env).name)?.value;
  if (token) {
    await getPrisma().session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  // Written with the same attributes as when it was set: browsers ignore a `__Host-` cookie without Secure,
  // also one that only clears it.
  await writeSessionCookie("", 0);
}

/** Bumps `sessionVersion` and deletes every session of the user. Pass `tx` to join a transaction. */
export async function revokeSessions(userId: string, tx?: Prisma.TransactionClient): Promise<number> {
  if (!tx) return getPrisma().$transaction((inner) => revokeSessions(userId, inner));
  const user = await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  await tx.session.deleteMany({ where: { userId } });
  return user.sessionVersion;
}
