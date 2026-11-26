"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import {
  changeDisplayName,
  changePassword,
  confirmEmail,
  isThrottled,
  requestEmailChange,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signUp,
} from "@/lib/id/accounts";
import { LOGOUT_PARAMS, resolvePostLogoutRedirect } from "@/lib/id/logout";
import { destroySession, getCurrentUser } from "@/lib/id/session";
import { verifyLoginPath } from "./_components/verify-path";
import { normalizeEmail, ValidationError } from "@/lib/id/validation";

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

/** The signed-in user for an account form, or a redirect to the login page. */
async function requireUser(locale: Locale) {
  const current = await getCurrentUser();
  if (!current) redirect(getPathname({ href: "/login", locale }));
  return current.user;
}

/** The message key for a ValidationError or a throttled request; anything else is rethrown. */
function validationErrorKey(error: unknown) {
  if (error instanceof ValidationError) return `Errors.${error.code}` as "Errors.emailInvalid";
  if (isThrottled(error)) return "Errors.throttled";
  throw error;
}

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const t = await getTranslations({ locale, namespace: "Id" });
  const fields = { email: text(formData, "email"), displayName: text(formData, "displayName") };
  try {
    await signUp({ ...fields, password: text(formData, "password") });
    return { notice: t("Signup.sentBody", { email: normalizeEmail(fields.email) }) };
  } catch (error) {
    return { error: t(validationErrorKey(error)), fields };
  }
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
    target = await resolvePostLogoutRedirect(params);
  } catch (error) {
    // Still signed out: stay on our own page.
    console.error("[id] failed to resolve the post-logout address:", error instanceof Error ? error.message : error);
  }
  redirect(target ?? getPathname({ href: "/signed-out", locale: formLocale(formData) }));
}

export async function resendVerificationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: "Id" });
  let result: Awaited<ReturnType<typeof resendVerification>>;
  try {
    result = await resendVerification(user.email);
  } catch (error) {
    if (isThrottled(error)) return { error: t("Errors.throttled") };
    console.error("[id] failed to resend the verify mail:", error instanceof Error ? error.message : error);
    return { error: t("Errors.mailFailed") };
  }
  return { notice: t(result === "sent" ? "Account.resent" : "Account.alreadyVerified") };
}

export async function changeDisplayNameAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: "Id" });
  const fields = { displayName: text(formData, "displayName") };
  try {
    await changeDisplayName(fields.displayName);
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
    const result = await requestEmailChange(user, fields.email, text(formData, "currentPassword"));
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
  if (result !== "ok") return { error: t(`Errors.${result}`) };
  return { notice: t("Account.passwordChanged") };
}

export async function requestPasswordResetAction(_state: FormState, formData: FormData): Promise<FormState> {
  const locale = formLocale(formData);
  const t = await getTranslations({ locale, namespace: "Id" });
  const fields = { email: text(formData, "email") };
  await requestPasswordReset(fields.email);
  return { notice: t("Forgot.sentBody") };
}

export type VerifyState =
  | { outcome: "verified" | "emailChanged" | "emailTaken" | "invalid" | "wrongAccount" }
  | undefined;

/**
 * The verify page's button: the only place a verify / email change link is used (never on GET).
 * Only the account the link was sent for can use it, so it needs that account to be signed in.
 */
export async function confirmEmailAction(_state: VerifyState, formData: FormData): Promise<VerifyState> {
  const token = text(formData, "token");
  const current = await getCurrentUser();
  if (!current) redirect(verifyLoginPath(formLocale(formData), token));
  const result = await confirmEmail(token, { userId: current.user.id, sessionId: current.session.id });
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
