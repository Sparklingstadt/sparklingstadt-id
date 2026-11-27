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
import { TwoFactorForm } from "./two-factor-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/two-factor">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return idMetadata(locale, "twoFactor");
}

/**
 * The second step of a password sign-in while 2FA is on (the login page comes here with the same `next`). Better
 * Auth makes the session only once a code is accepted; then the form goes on to `next`, which for a client is the
 * authorize URL and so passes its checks again.
 */
export default async function TwoFactorPage({ params, searchParams }: PageProps<"/[locale]/two-factor">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { next, reauth } = await searchParams;
  const target = safeNextPath(typeof next === "string" ? next : "", getPathname({ href: "/account", locale }));
  if (reauth !== "1" && (await getCurrentUser())) redirect(target);

  const loginParams = new URLSearchParams();
  if (typeof next === "string") loginParams.set("next", next);
  if (reauth === "1") loginParams.set("reauth", "1");
  const loginHref = `${getPathname({ href: "/login", locale })}${loginParams.size ? `?${loginParams}` : ""}`;

  const t = await getTranslations({ locale, namespace: "Id" });
  return (
    <IdShell locale={locale} pathname="/two-factor">
      <h1>{t("TwoFactor.heading")}</h1>
      <TwoFactorForm
        redirectTo={target}
        loginHref={loginHref}
        labels={{
          lead: t("TwoFactor.lead"),
          backupLead: t("TwoFactor.backupLead"),
          code: t("TwoFactor.code"),
          backupCode: t("TwoFactor.backupCode"),
          submit: t("TwoFactor.submit"),
          pending: t("TwoFactor.pending"),
          useBackup: t("TwoFactor.useBackup"),
          useTotp: t("TwoFactor.useTotp"),
          expired: t("TwoFactor.expired"),
          backToLogin: t("TwoFactor.backToLogin"),
          wrongCode: t("Errors.wrongCode"),
          throttled: t("Errors.throttled"),
        }}
      />
    </IdShell>
  );
}
