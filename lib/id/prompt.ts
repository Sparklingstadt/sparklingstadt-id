/**
 * The `prompt` values the authorize endpoint acts on (OIDC Core 3.1.2.1): `login` asks to sign in again even with a
 * session, `none` forbids any screen. Other values (such as `consent`) are ignored.
 */
export function parsePrompt(prompt: string | null): { login: boolean; none: boolean } {
  const values = (prompt ?? "").split(" ");
  return { login: values.includes("login"), none: values.includes("none") };
}

/**
 * The authorize path to come back to after signing in again: the same request without `prompt`, so that the
 * session just made issues the code instead of asking for the login again.
 */
export function authorizePathWithoutPrompt(pathname: string, params: URLSearchParams): string {
  const rest = new URLSearchParams(params);
  rest.delete("prompt");
  return `${pathname}?${rest}`;
}
