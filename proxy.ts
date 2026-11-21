import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  return intlMiddleware(request);
}

export const config = {
  // /oauth and /.well-known are the OIDC provider (not localized).
  matcher: "/((?!api|trpc|_next|_vercel|oauth|\\.well-known|.*\\..*).*)",
};
