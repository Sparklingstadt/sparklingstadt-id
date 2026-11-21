/** Whether an authorization request's `prompt` asks to sign in again even with a session (OIDC Core 3.1.2.1). */
export function wantsLogin(prompt: string | null): boolean {
  return (prompt ?? "").split(" ").includes("login");
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
