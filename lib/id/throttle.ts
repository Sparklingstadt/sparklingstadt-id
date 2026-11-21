import { getPrisma } from "@/lib/prisma";

export { clientIp } from "./client-ip.ts";

/** Counts one attempt in a 15 minute window; false once `limit` is exceeded. */
export async function consumeThrottle(key: string, limit: number): Promise<boolean> {
  const rows = await getPrisma().$queryRaw<{ count: number }[]>`
    INSERT INTO throttles ("key", count, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      count = CASE WHEN throttles.window_start < now() - interval '15 minutes'
        THEN 1 ELSE throttles.count + 1 END,
      window_start = CASE WHEN throttles.window_start < now() - interval '15 minutes'
        THEN now() ELSE throttles.window_start END
    RETURNING count`;
  return Number(rows[0].count) <= limit;
}

export async function resetThrottle(key: string): Promise<void> {
  await getPrisma().throttle.deleteMany({ where: { key } });
}
