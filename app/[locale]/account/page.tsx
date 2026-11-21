import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/id/session";
import { DisplayNameForm } from "../_components/display-name-form";
import { EmailForm } from "../_components/email-form";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";
import { PasswordForm } from "../_components/password-form";
import { logOutAction } from "../actions";
import { ResendForm } from "./resend-form";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return idMetadata(locale, "account");
}

export default async function AccountPage({ params, searchParams }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const current = await getCurrentUser();
  if (!current) redirect(`${getPathname({ href: "/login", locale })}?next=${encodeURIComponent(getPathname({ href: "/account", locale }))}`);
  const { user } = current;
  const { verify } = await searchParams;
  const t = await getTranslations({ locale, namespace: "Id" });

  return (
    <IdShell locale={locale} pathname="/account">
      <h1>{t("Account.heading")}</h1>
      <dl className="id-profile">
        <div><dt>{t("Account.displayName")}</dt><dd>{user.displayName}</dd></div>
        <div><dt>{t("Account.email")}</dt><dd>{user.email}</dd></div>
      </dl>
      {user.emailVerifiedAt ? null : (
        <div className="id-section">
          <p className="id-alert">
            {verify === "required" ? `${t("Account.verifyRequired")} ` : null}
            {t("Account.unverified")}
          </p>
          <ResendForm locale={locale} label={t("Account.resend")} />
        </div>
      )}
      <DisplayNameForm
        locale={locale}
        labels={{
          heading: t("Account.displayNameHeading"),
          displayName: t("Account.newDisplayName"),
          hint: t("Fields.displayNameHint"),
          submit: t("Account.changeDisplayName"),
          pending: t("Account.pending"),
        }}
      />
      <EmailForm
        locale={locale}
        labels={{
          heading: t("Account.emailHeading"),
          lead: t("Account.emailLead"),
          email: t("Account.newEmail"),
          currentPassword: t("Account.currentPassword"),
          submit: t("Account.changeEmail"),
          pending: t("Account.pending"),
        }}
      />
      <PasswordForm
        locale={locale}
        labels={{
          heading: t("Account.passwordHeading"),
          currentPassword: t("Account.currentPassword"),
          newPassword: t("Account.newPassword"),
          hint: t("Fields.passwordHint"),
          submit: t("Account.changePassword"),
          pending: t("Account.pending"),
        }}
      />
      <form className="id-section" action={logOutAction}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="button text">{t("Account.logout")}</button>
      </form>
    </IdShell>
  );
}
