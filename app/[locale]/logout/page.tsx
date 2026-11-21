import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { LOGOUT_PARAMS } from "@/lib/id/logout";
import { getCurrentUser } from "@/lib/id/session";
import { IdShell } from "../_components/id-shell";
import { idMetadata } from "../_components/id-metadata";
import { confirmLogoutAction } from "../actions";

export async function generateMetadata({ params }: PageProps<"/[locale]/logout">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // An id_token_hint may be in the URL: never hand it to another site.
  return { ...(await idMetadata(locale, "logout")), referrer: "no-referrer" };
}

/**
 * The logout question: /oauth/logout sends a request here when it cannot tell that a client sent it (anyone can
 * make a browser open that URL). Opening this page ends nothing; the button posts confirmLogoutAction.
 */
export default async function LogoutPage({ params, searchParams }: PageProps<"/[locale]/logout">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!(await getCurrentUser())) redirect(getPathname({ href: "/signed-out", locale }));
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: "Id.Logout" });

  return (
    <IdShell locale={locale} pathname="/logout">
      <h1>{t("heading")}</h1>
      <p className="id-lead">{t("body")}</p>
      <form className="id-form" action={confirmLogoutAction}>
        <input type="hidden" name="locale" value={locale} />
        {LOGOUT_PARAMS.map((name) => {
          const value = query[name];
          return typeof value === "string" ? <input key={name} type="hidden" name={name} value={value} /> : null;
        })}
        <button type="submit" className="button primary">{t("submit")}</button>
      </form>
      <p className="id-links">
        <a href={getPathname({ href: "/account", locale })}>{t("cancel")}</a>
      </p>
    </IdShell>
  );
}
