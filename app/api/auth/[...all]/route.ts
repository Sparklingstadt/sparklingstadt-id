import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { OIDC_URL_PATHS } from "@/lib/id/oidc-urls";

const handler = toNextJsHandler(auth);

/**
 * The token endpoint authenticates the client, never a browser session. Its cookies are dropped, so that a call that
 * happens to carry one is not held to the browser's Origin check (a client calls it from its server, without Origin).
 */
const WITHOUT_COOKIES = new Set(["/api/auth/oauth2/token"]);

/** The request under the Better Auth path that serves it, when it was rewritten here from one of the /oauth/* URLs. */
async function forBetterAuth(request: Request): Promise<Request> {
  const url = new URL(request.url);
  const target = OIDC_URL_PATHS[url.pathname];
  if (target) url.pathname = target;
  const dropCookies = WITHOUT_COOKIES.has(url.pathname) && request.headers.has("cookie");
  if (!target && !dropCookies) return request;
  const headers = new Headers(request.headers);
  if (dropCookies) headers.delete("cookie");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(url, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined });
}

export async function GET(request: Request) {
  return handler.GET(await forBetterAuth(request));
}

export async function POST(request: Request) {
  return handler.POST(await forBetterAuth(request));
}
