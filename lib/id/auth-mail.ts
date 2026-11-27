import { cookies } from "next/headers";
import { hasLocale } from "next-intl";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { rememberChangeEmailLink, requestTypeOf } from "./email-links.ts";
import { sendMail, type MailKind } from "./mailer.ts";

/** The language of the screen the request came from (the cookie next-intl keeps), else the default. */
async function mailLocale(): Promise<Locale> {
  try {
    // Called first and synchronously by mailTo, while the request is still known (a background task has none).
    const value = (await cookies()).get("NEXT_LOCALE")?.value;
    return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
  } catch {
    return routing.defaultLocale;
  }
}

/** `${ID_ISSUER}` + the locale-aware path, e.g. https://…/zh-cn/verify */
function portalUrl(href: string, locale: Locale): string {
  const issuer = process.env.ID_ISSUER?.trim().replace(/\/+$/, "");
  if (!issuer) throw new Error("Sparklingstadt ID is not configured: missing ID_ISSUER");
  return `${issuer}${getPathname({ href, locale })}`;
}

/** Never throws: a failed send must look the same to the visitor (no enumeration). */
async function sendMailQuietly(input: Parameters<typeof sendMail>[0]): Promise<void> {
  try {
    await sendMail(input);
  } catch (error) {
    // The error never contains the link; log only the kind and the reason.
    console.error(`[id] failed to send a ${input.kind} mail:`, error instanceof Error ? error.message : error);
  }
}

/** Sends one mail in the language of the current request. */
async function mailTo(
  kind: MailKind,
  to: string,
  link: (locale: Locale) => string,
  language: Promise<Locale> = mailLocale(),
): Promise<void> {
  try {
    const locale = await language;
    await sendMailQuietly({ to, kind, locale, link: link(locale) });
  } catch (error) {
    console.error(`[id] failed to build a ${kind} mail:`, error instanceof Error ? error.message : error);
  }
}

/** A link to the page that offers the confirm button; the token is Better Auth's. */
const tokenLink = (href: string, token: string) => (locale: Locale) => `${portalUrl(href, locale)}?token=${token}`;

/** The mail for an email change: to the NEW address, whose link only the latest request keeps valid. */
async function sendChangeEmailVerification(data: { user: { id: string; email: string }; token: string }): Promise<void> {
  const language = mailLocale();
  try {
    await rememberChangeEmailLink(data.user.id, data.token);
  } catch (error) {
    console.error("[id] failed to record the email change link:", error instanceof Error ? error.message : error);
    return;
  }
  await mailTo("changeEmail", data.user.email, tokenLink("/verify", data.token), language);
}

/** Tells the current address that someone asked to move the account (not where to), with the way to stop it. */
export async function sendEmailChangeRequested(to: string): Promise<void> {
  await mailTo("emailChangeRequested", to, (locale) => portalUrl("/forgot", locale));
}

export const mailHooks = {
  // Better Auth sends the email change link through the same hook as the sign-up one; the token says which it is.
  async sendVerificationEmail(data: { user: { id: string; email: string }; token: string }): Promise<void> {
    if (requestTypeOf(data.token) === "change-email-verification") return sendChangeEmailVerification(data);
    await mailTo("verify", data.user.email, tokenLink("/verify", data.token));
  },
  async sendResetPassword(data: { user: { email: string }; token: string }): Promise<void> {
    await mailTo("resetPassword", data.user.email, tokenLink("/reset", data.token));
  },
  sendChangeEmailVerification,
  /** Someone signed up with an address that has an account: say so, and point at the password reset. */
  async onExistingUserSignUp(data: { user: { email: string } }): Promise<void> {
    await mailTo("alreadyRegistered", data.user.email, (locale) => portalUrl("/forgot", locale));
  },
};
