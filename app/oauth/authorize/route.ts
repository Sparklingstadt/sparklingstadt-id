import type { NextRequest } from "next/server";
import { hasLocale } from "next-intl";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { authorizeError, issueAuthCode, redirectToClient } from "@/lib/id/authorization";
import { findClient, isRegisteredRedirect } from "@/lib/id/clients";
import { getOidcConfig } from "@/lib/id/config";
import { isS256Challenge } from "@/lib/id/pkce";
import { authorizePathWithoutPrompt, parsePrompt } from "@/lib/id/prompt";
import { getCurrentUser } from "@/lib/id/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The locale is not known yet when the client itself is invalid, so the page shows all three.
const ERROR_PAGE = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sparklingstadt ID</title>
</head>
<body>
<h1>Sparklingstadt ID</h1>
<p lang="ja">ログインの要求が正しくありません。利用中のサービスに戻って、もう一度お試しください。</p>
<p lang="zh-CN">登录请求无效。请返回正在使用的服务后重试。</p>
<p lang="zh-TW">登入請求無效。請返回正在使用的服務後重試。</p>
</body>
</html>
`;

function errorPage(status: number): Response {
  return new Response(ERROR_PAGE, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 302, headers: { Location: path, "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  let clients: ReturnType<typeof getOidcConfig>["clients"];
  try {
    ({ clients } = getOidcConfig());
  } catch {
    return errorPage(500);
  }

  const params = request.nextUrl.searchParams;
  // 1. Unknown client or unregistered redirect_uri: never redirect.
  const client = findClient(clients, params.get("client_id"));
  const redirectUri = params.get("redirect_uri");
  if (!client || !redirectUri || !isRegisteredRedirect(client, redirectUri)) return errorPage(400);

  // 2. Other errors go back to the client.
  const state = params.get("state");
  if (params.get("response_type") !== "code") {
    return authorizeError(redirectUri, "unsupported_response_type", state);
  }
  const scope = params.get("scope") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  if (
    !scope.split(" ").includes("openid") ||
    !isS256Challenge(codeChallenge) ||
    params.get("code_challenge_method") !== "S256"
  ) {
    return authorizeError(redirectUri, "invalid_request", state);
  }

  // 3. prompt=none never shows a screen: answer with an error instead of sending the user to log in or confirm.
  const prompt = parsePrompt(params.get("prompt"));
  if (prompt.none && prompt.other) return authorizeError(redirectUri, "invalid_request", state);

  // 4. Not signed in: log in, then come back to this exact URL. With prompt=login, log in even when signed in, then
  //    come back without the prompt, so that the new session issues the code.
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale = hasLocale(routing.locales, cookieLocale) ? cookieLocale : routing.defaultLocale;
  const loginPath = getPathname({ href: "/login", locale });
  if (prompt.login) {
    const next = authorizePathWithoutPrompt(request.nextUrl.pathname, params);
    return redirectTo(`${loginPath}?${new URLSearchParams({ next, reauth: "1" })}`);
  }
  const current = await getCurrentUser();
  if (!current) {
    if (prompt.none) return authorizeError(redirectUri, "login_required", state);
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return redirectTo(`${loginPath}?${new URLSearchParams({ next })}`);
  }

  // 5. Unconfirmed email: the account page asks to confirm it first.
  if (!current.user.emailVerifiedAt) {
    if (prompt.none) return authorizeError(redirectUri, "interaction_required", state);
    return redirectTo(`${getPathname({ href: "/account", locale })}?verify=required`);
  }

  // 6. Issue a code.
  const code = await issueAuthCode({
    clientId: client.id,
    userId: current.user.id,
    redirectUri,
    codeChallenge,
    nonce: params.get("nonce") ?? undefined,
    authTime: current.session.createdAt,
  });
  return redirectToClient(redirectUri, { code, state });
}
