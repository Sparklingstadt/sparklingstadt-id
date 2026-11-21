import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getOidcConfig } from "@/lib/id/config";
import { resolvePostLogoutRedirect } from "@/lib/id/logout";
import { destroySession } from "@/lib/id/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

/** RP-Initiated Logout: end the session, then send the user back to the client (or to our signed-out page). */
export async function GET(request: NextRequest) {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale = hasLocale(routing.locales, cookieLocale) ? cookieLocale : routing.defaultLocale;

  await destroySession();

  let target: string | null = null;
  try {
    target = resolvePostLogoutRedirect(getOidcConfig(), request.nextUrl.searchParams);
  } catch {
    // Not configured: still signed out, stay on our own page.
  }
  return redirectTo(target ?? getPathname({ href: "/signed-out", locale }));
}
