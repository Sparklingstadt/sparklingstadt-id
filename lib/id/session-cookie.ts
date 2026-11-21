/**
 * The session cookie's name and `Secure` flag. Over HTTPS the name carries the `__Host-` prefix: browsers only
 * accept such a cookie from this host itself (Secure, Path=/, no Domain), so another host of the same domain
 * cannot plant a session here. Browsers refuse the prefix without Secure, so http (development, E2E) keeps the
 * plain name.
 */
export function sessionCookie(env: { NODE_ENV?: string; ID_ISSUER?: string }): { name: string; secure: boolean } {
  const secure = env.NODE_ENV === "production" && !env.ID_ISSUER?.startsWith("http://");
  return { name: secure ? "__Host-sid_session" : "sid_session", secure };
}
