import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/** The login page for a signed-out visitor of a verify link, which sends them back to the link afterwards. */
export function verifyLoginPath(locale: Locale, token: string): string {
  const next = `${getPathname({ href: "/verify", locale })}?token=${encodeURIComponent(token)}`;
  return `${getPathname({ href: "/login", locale })}?confirm=1&next=${encodeURIComponent(next)}`;
}
