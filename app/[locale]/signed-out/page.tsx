import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";

export async function generateMetadata({ params }: PageProps<"/[locale]/signed-out">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return idMetadata(locale, "signedOut");
}

export default async function SignedOutPage({ params }: PageProps<"/[locale]/signed-out">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Id.SignedOut" });
  return (
    <IdShell locale={locale} pathname="/signed-out">
      <h1>{t("heading")}</h1>
      <p>{t("body")}</p>
      <p>
        <a href={getPathname({ href: "/login", locale })}>{t("loginLink")}</a>
      </p>
    </IdShell>
  );
}
