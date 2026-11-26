import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/id/session";
import { safeNextPath } from "@/lib/id/validation";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";
import { LogInForm } from "./login-form";
import { PasskeyButton } from "./passkey-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return idMetadata(locale, "login");
}

export default async function LogInPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { next, reset, confirm, reauth, fresh } = await searchParams;
  // Where to go once signed in; the same check applies when a signed-in visitor opens this page.
  const target = safeNextPath(typeof next === "string" ? next : "", getPathname({ href: "/account", locale }));
  // Already signed in: go straight on, unless a service asked for the login again (prompt=login).
  if (reauth !== "1" && (await getCurrentUser())) redirect(target);

  const t = await getTranslations({ locale, namespace: "Id" });
  return (
    <IdShell locale={locale} pathname="/login">
      <h1>{t("Login.heading")}</h1>
      <p className="id-lead">{t("Login.lead")}</p>
      {reset === "done" ? <p className="id-notice" role="status">{t("Login.passwordReset")}</p> : null}
      {confirm === "1" ? <p className="id-notice" role="status">{t("Login.confirmFirst")}</p> : null}
      {fresh === "1" ? <p className="id-notice" role="status">{t("Login.freshRequired")}</p> : null}
      <LogInForm
        redirectTo={target}
        labels={{
          email: t("Fields.email"),
          password: t("Fields.password"),
          submit: t("Login.submit"),
          pending: t("Login.pending"),
          invalidCredentials: t("Errors.invalidCredentials"),
          throttled: t("Errors.throttled"),
        }}
      />
      <PasskeyButton
        redirectTo={target}
        labels={{ label: t("Login.passkey"), pending: t("Login.passkeyPending"), failed: t("Login.passkeyFailed") }}
      />
      <p className="id-links">
        <a href={getPathname({ href: "/forgot", locale })}>{t("Login.forgotLink")}</a>
      </p>
      <p className="id-links">
        {t("Login.noAccount")} <a href={getPathname({ href: "/signup", locale })}>{t("Login.signupLink")}</a>
      </p>
    </IdShell>
  );
}
