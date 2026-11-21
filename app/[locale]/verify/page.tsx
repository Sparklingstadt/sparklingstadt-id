import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { emailTokenPurpose } from "@/lib/id/accounts";
import { getCurrentUser } from "@/lib/id/session";
import { verifyLoginPath } from "../_components/verify-path";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";
import { VerifyForm, VerifyOutcome } from "./verify-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/verify">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // The token is in the URL: never hand it to another site.
  return { ...(await idMetadata(locale, "verify")), referrer: "no-referrer" };
}

/**
 * Opening the link changes nothing (mail scanners and previews fetch links too): the page only
 * checks the token read-only and offers a button; confirmEmailAction uses the token on POST.
 * The button is only offered to the account the link was sent for: a signed-out visitor logs in first.
 */
export default async function VerifyPage({ params, searchParams }: PageProps<"/[locale]/verify">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { token } = await searchParams;
  const tokenValue = typeof token === "string" ? token : "";
  const found = await emailTokenPurpose(tokenValue);
  const current = found ? await getCurrentUser() : null;
  if (found && !current) redirect(verifyLoginPath(locale, tokenValue));
  const purpose = found && current?.user.id === found.userId ? found.purpose : null;
  const t = await getTranslations({ locale, namespace: "Id.Verify" });
  const accountHref = getPathname({ href: "/account", locale });
  const outcomes = {
    verified: { heading: t("verifiedHeading"), body: t("verifiedBody") },
    emailChanged: { heading: t("emailChangedHeading"), body: t("emailChangedBody") },
    emailTaken: { heading: t("emailTakenHeading"), body: t("emailTakenBody") },
    invalid: { heading: t("invalidHeading"), body: t("invalidBody") },
    wrongAccount: { heading: t("wrongAccountHeading"), body: t("wrongAccountBody") },
  };

  return (
    <IdShell locale={locale} pathname="/verify">
      {purpose ? (
        <VerifyForm
          locale={locale}
          token={tokenValue}
          prompt={
            purpose === "change_email"
              ? { heading: t("confirmChangeHeading"), body: t("confirmChangeBody") }
              : { heading: t("confirmHeading"), body: t("confirmBody") }
          }
          submit={purpose === "change_email" ? t("confirmChangeSubmit") : t("confirmSubmit")}
          pending={t("pending")}
          outcomes={outcomes}
          accountHref={accountHref}
          accountLabel={t("toAccount")}
        />
      ) : (
        <VerifyOutcome screen={found ? outcomes.wrongAccount : outcomes.invalid} accountHref={accountHref} accountLabel={t("toAccount")} />
      )}
    </IdShell>
  );
}
