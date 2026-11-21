import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/forgot">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return idMetadata(locale, "forgot");
}

export default async function ForgotPage({ params }: PageProps<"/[locale]/forgot">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Id" });

  return (
    <IdShell locale={locale} pathname="/forgot">
      <ForgotForm
        locale={locale}
        labels={{
          heading: t("Forgot.heading"),
          lead: t("Forgot.lead"),
          email: t("Fields.email"),
          submit: t("Forgot.submit"),
          pending: t("Forgot.pending"),
          sentHeading: t("Forgot.sentHeading"),
        }}
      />
      <p className="id-links">
        <a href={getPathname({ href: "/login", locale })}>{t("Forgot.loginLink")}</a>
      </p>
    </IdShell>
  );
}
