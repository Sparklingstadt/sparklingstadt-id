import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";

type IdPage = "signup" | "login" | "account" | "verify" | "forgot" | "reset" | "logout" | "signedOut";

/** account pages are personal: never indexed. */
export async function idMetadata(locale: Locale, page: IdPage): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Id.Metadata" });
  return { title: `${t(page)} — Sparklingstadt ID`, robots: { index: false, follow: false } };
}
