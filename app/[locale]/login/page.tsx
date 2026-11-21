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

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return idMetadata(locale, "login");
}

export default async function LogInPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { next, reset, confirm, reauth } = await searchParams;
  const nextValue = typeof next === "string" ? next : "";
  // Already signed in: go straight on (the same check the action applies after login), unless a service asked for
  // the login again (prompt=login).
  if (reauth !== "1" && (await getCurrentUser())) {
    redirect(safeNextPath(nextValue, getPathname({ href: "/account", locale })));
  }

  const t = await getTranslations({ locale, namespace: "Id" });
  return (
    <IdShell locale={locale} pathname="/login">
      <h1>{t("Login.heading")}</h1>
      <p className="id-lead">{t("Login.lead")}</p>
      {reset === "done" ? <p className="id-notice" role="status">{t("Login.passwordReset")}</p> : null}
      {confirm === "1" ? <p className="id-notice" role="status">{t("Login.confirmFirst")}</p> : null}
      <LogInForm
        locale={locale}
        next={nextValue}
        labels={{
          email: t("Fields.email"),
          password: t("Fields.password"),
          submit: t("Login.submit"),
          pending: t("Login.pending"),
        }}
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
