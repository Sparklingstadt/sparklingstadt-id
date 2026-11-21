import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isResetTokenUsable } from "@/lib/id/accounts";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";
import { InvalidResetLink, ResetForm } from "./reset-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/reset">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // The token is in the URL: never hand it to another site.
  return { ...(await idMetadata(locale, "reset")), referrer: "no-referrer" };
}

export default async function ResetPage({ params, searchParams }: PageProps<"/[locale]/reset">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { token } = await searchParams;
  const tokenValue = typeof token === "string" ? token : "";
  const t = await getTranslations({ locale, namespace: "Id" });
  const forgotHref = getPathname({ href: "/forgot", locale });
  const labels = {
    heading: t("Reset.heading"),
    lead: t("Reset.lead"),
    password: t("Reset.newPassword"),
    hint: t("Fields.passwordHint"),
    submit: t("Reset.submit"),
    pending: t("Reset.pending"),
    invalidHeading: t("Reset.invalidHeading"),
    invalidBody: t("Reset.invalidBody"),
    forgotLink: t("Reset.forgotLink"),
  };

  return (
    <IdShell locale={locale} pathname="/reset">
      {(await isResetTokenUsable(tokenValue)) ? (
        <ResetForm locale={locale} token={tokenValue} forgotHref={forgotHref} labels={labels} />
      ) : (
        <InvalidResetLink forgotHref={forgotHref} labels={labels} />
      )}
    </IdShell>
  );
}
