import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";
import { SignUpForm } from "./signup-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return idMetadata(locale, "signup");
}

export default async function SignUpPage({ params }: PageProps<"/[locale]/signup">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Id" });

  return (
    <IdShell locale={locale} pathname="/signup">
      <SignUpForm
        locale={locale}
        labels={{
          heading: t("Signup.heading"),
          lead: t("Signup.lead"),
          email: t("Fields.email"),
          displayName: t("Fields.displayName"),
          displayNameHint: t("Fields.displayNameHint"),
          password: t("Fields.password"),
          passwordHint: t("Fields.passwordHint"),
          submit: t("Signup.submit"),
          pending: t("Signup.pending"),
          sentHeading: t("Signup.sentHeading"),
        }}
      />
      <p className="id-links">
        {t("Signup.haveAccount")} <a href={getPathname({ href: "/login", locale })}>{t("Signup.loginLink")}</a>
      </p>
    </IdShell>
  );
}
