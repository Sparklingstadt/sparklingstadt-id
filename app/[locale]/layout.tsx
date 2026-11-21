import type { Metadata } from "next";
import { Noto_Sans_JP, Shippori_Mincho } from "next/font/google";
import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { htmlLanguages, routing } from "@/i18n/routing";
import "../globals.css";

const sans = Noto_Sans_JP({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const serif = Shippori_Mincho({
  variable: "--font-serif",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sparklingstadt ID",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={htmlLanguages[locale]}>
      <body className={`${sans.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}
