import { routing } from "../../i18n/routing.ts";

/**
 * Where the login page goes when the password was right but the account has 2FA on: the 2FA page in the same
 * language, with the same `next` (for a client, the authorize URL to go back to) and reauth flag.
 */
export function twoFactorPagePath(loginPathname: string, search: string): string {
  const first = loginPathname.split("/")[1] ?? "";
  const locale = first !== routing.defaultLocale && (routing.locales as readonly string[]).includes(first) ? first : null;
  const from = new URLSearchParams(search);
  const carried = new URLSearchParams();
  for (const name of ["next", "reauth"]) {
    const value = from.get(name);
    if (value !== null) carried.set(name, value);
  }
  const query = carried.toString();
  return `${locale ? `/${locale}` : ""}/two-factor${query ? `?${query}` : ""}`;
}
