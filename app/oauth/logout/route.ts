import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { LOGOUT_PARAMS, logoutHintSubject, resolvePostLogoutRedirect } from "@/lib/id/logout";
import { destroySession, getCurrentUser } from "@/lib/id/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

/**
 * RP-Initiated Logout: end the session, then send the user back to the client (or to our signed-out page).
 * Anyone can make a browser open this URL, so it ends the session by itself only when the request carries the
 * signed-in user's own ID token, which only a client that user signed in to holds. Any other request is sent to
 * the logout question, where the user answers.
 */
export async function GET(request: NextRequest) {
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale = hasLocale(routing.locales, cookieLocale) ? cookieLocale : routing.defaultLocale;
  const params = request.nextUrl.searchParams;

  const target = (await resolvePostLogoutRedirect(params)) ?? getPathname({ href: "/signed-out", locale });

  // Nobody is signed in: there is nothing to end. The cookie is left alone as well: a request made from another
  // site arrives without it, and clearing it in the answer would sign the user out after all.
  const current = await getCurrentUser();
  if (!current) return redirectTo(target);

  if ((await logoutHintSubject(params)) !== current.user.id) {
    const kept = new URLSearchParams(
      [...params].filter(([name]) => (LOGOUT_PARAMS as readonly string[]).includes(name)),
    );
    const question = getPathname({ href: "/logout", locale });
    return redirectTo(kept.size > 0 ? `${question}?${kept}` : question);
  }

  await destroySession();
  return redirectTo(target);
}
