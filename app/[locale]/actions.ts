"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import {
  changeDisplayName,
  changePassword,
  confirmEmailToken,
  logIn,
  requestEmailChange,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signUp,
} from "@/lib/id/accounts";
import { clientIp } from "@/lib/id/client-ip";
import { getOidcConfig } from "@/lib/id/config";
import { LOGOUT_PARAMS, resolvePostLogoutRedirect } from "@/lib/id/logout";
import { createSession, destroySession, getCurrentUser } from "@/lib/id/session";
import { verifyLoginPath } from "./_components/verify-path";
import { normalizeEmail, safeNextPath, ValidationError } from "@/lib/id/validation";

/** Never carries the password back to the form. */
export type FormState =
  | { error?: string; notice?: string; fields?: Record<string, string>; invalidLink?: true }
  | undefined;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function formLocale(formData: FormData): Locale {
  const value = text(formData, "locale");
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

/** The signed-in user for an account form, or a redirect to the login page. */
async function requireUser(locale: Locale) {
  const current = await getCurrentUser();
  if (!current) redirect(getPathname({ href: "/login", locale }));
  return current.user;
}

/** The message key for a ValidationError; anything else is rethrown. */
function validationErrorKey(error: unknown) {
  if (error instanceof ValidationError) return `Errors.${error.code}` as "Errors.emailInvalid";
  throw error;
}

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const t = await getTranslations({ locale, namespace: "Id" });
  const fields = { email: text(formData, "email"), displayName: text(formData, "displayName") };
  try {
    const result = await signUp({ ...fields, password: text(formData, "password"), locale, ip: await requestIp() });
    if (result === "throttled") return { error: t("Errors.throttled"), fields };
    return { notice: t("Signup.sentBody", { email: normalizeEmail(fields.email) }) };
  } catch (error) {
    return { error: t(validationErrorKey(error)), fields };
  }
}

export async function logInAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const fields = { email: text(formData, "email") };
  const result = await logIn({ email: fields.email, password: text(formData, "password"), ip: await requestIp() });
  if (!result.ok) {
    const t = await getTranslations({ locale, namespace: "Id.Errors" });
    return { error: t(result.reason === "throttled" ? "throttled" : "invalidCredentials"), fields };
  }
  // Signing in again over a session (prompt=login) replaces it rather than leaving its row behind.
  await destroySession();
  await createSession(result.userId, result.sessionVersion);
  redirect(safeNextPath(text(formData, "next"), getPathname({ href: "/account", locale })));
}

export async function logOutAction(formData: FormData): Promise<void> {
  await destroySession();
  redirect(getPathname({ href: "/login", locale: formLocale(formData) }));
}

/**
 * The logout question's button (/oauth/logout sends a request there that it cannot tell from a planted link):
 * ends the session, then goes back to the client when the request names a registered address.
 */
export async function confirmLogoutAction(formData: FormData): Promise<void> {
  const params = new URLSearchParams();
  for (const name of LOGOUT_PARAMS) {
    const value = text(formData, name);
    if (value) params.set(name, value);
  }
  await destroySession();
  let target: string | null = null;
  try {
    target = resolvePostLogoutRedirect(getOidcConfig(), params);
  } catch {
    // Not configured: still signed out, stay on our own page.
  }
  redirect(target ?? getPathname({ href: "/signed-out", locale: formLocale(formData) }));
}

export async function resendVerificationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: "Id" });
  let result: Awaited<ReturnType<typeof resendVerification>>;
  try {
    result = await resendVerification(user.id, locale, await requestIp());
  } catch (error) {
    console.error("[id] failed to resend the verify mail:", error instanceof Error ? error.message : error);
    return { error: t("Errors.mailFailed") };
  }
  if (result === "throttled") return { error: t("Errors.throttled") };
  return { notice: t(result === "sent" ? "Account.resent" : "Account.alreadyVerified") };
}

export async function changeDisplayNameAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: "Id" });
  const fields = { displayName: text(formData, "displayName") };
  try {
    await changeDisplayName(user.id, fields.displayName);
  } catch (error) {
    return { error: t(validationErrorKey(error)), fields };
  }
  refresh(); // The profile on the page shows the new name right away.
  return { notice: t("Account.displayNameChanged") };
}

export async function requestEmailChangeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: "Id" });
  const fields = { email: text(formData, "email") };
  try {
    const result = await requestEmailChange(
      user.id,
      fields.email,
      text(formData, "currentPassword"),
      locale,
      await requestIp(),
    );
    if (result !== "sent") return { error: t(`Errors.${result}`), fields };
    return { notice: t("Account.emailChangeSent", { email: normalizeEmail(fields.email) }) };
  } catch (error) {
    return { error: t(validationErrorKey(error)), fields };
  }
}

export async function changePasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: "Id" });
  let result: Awaited<ReturnType<typeof changePassword>>;
  try {
    result = await changePassword(user.id, text(formData, "currentPassword"), text(formData, "newPassword"));
  } catch (error) {
    return { error: t(validationErrorKey(error)) };
  }
  if (!result.ok) return { error: t(`Errors.${result.reason}`) };
  // Every session was revoked, this one included: sign this browser in again.
  await createSession(user.id, result.sessionVersion);
  return { notice: t("Account.passwordChanged") };
}

export async function requestPasswordResetAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const t = await getTranslations({ locale, namespace: "Id" });
  const fields = { email: text(formData, "email") };
  const result = await requestPasswordReset(fields.email, locale, await requestIp());
  if (result === "throttled") return { error: t("Errors.throttled"), fields };
  return { notice: t("Forgot.sentBody") };
}

export type VerifyState =
  | { outcome: "verified" | "emailChanged" | "emailTaken" | "invalid" | "wrongAccount" }
  | undefined;

/**
 * The verify page's button: the only place a verify / change_email link is used (never on GET).
 * Only the account the link was sent for can use it, so it needs that account to be signed in.
 */
export async function confirmEmailAction(_state: VerifyState, formData: FormData): Promise<VerifyState> {
  const token = text(formData, "token");
  const current = await getCurrentUser();
  if (!current) redirect(verifyLoginPath(formLocale(formData), token));
  const result = await confirmEmailToken(token, current.user.id, current.session.id);
  if (result.ok) return { outcome: result.purpose === "change_email" ? "emailChanged" : "verified" };
  return { outcome: result.reason };
}

export async function resetPasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const t = await getTranslations({ locale, namespace: "Id" });
  let result: Awaited<ReturnType<typeof resetPassword>>;
  try {
    result = await resetPassword(text(formData, "token"), text(formData, "password"));
  } catch (error) {
    return { error: t(validationErrorKey(error)) };
  }
  if (!result.ok) return { invalidLink: true };
  redirect(`${getPathname({ href: "/login", locale })}?reset=done`);
}
