import { isIP } from "node:net";
import { getIP } from "better-auth/api";

/**
 * The header both limiters read: this module's clientIp (the per-address / per-account throttles) and Better Auth's
 * own per-IP rate limiter (`advanced.ipAddress` in lib/auth.ts).
 * The deployment target is Vercel, which overwrites x-forwarded-for with the single address of the client. Anywhere
 * else the header would be client-controlled, which is why a header that is not exactly one valid address counts as
 * unknown rather than being trusted (the same rule as Better Auth's, so the two never disagree).
 */
export const IP_ADDRESS_OPTIONS = { ipAddressHeaders: ["x-forwarded-for"] };

export function clientIp(headers: Pick<Headers, "get">): string {
  const value = headers.get(IP_ADDRESS_OPTIONS.ipAddressHeaders[0])?.trim();
  if (!value || value.includes(",") || !isIP(value)) return "unknown";
  // Better Auth's resolver, so an IPv6 address is collapsed to the same subnet it uses.
  return getIP(new Headers({ "x-forwarded-for": value }), { advanced: { ipAddress: IP_ADDRESS_OPTIONS } }) ?? "unknown";
}
