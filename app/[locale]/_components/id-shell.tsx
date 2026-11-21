import type { ReactNode } from "react";
import type { Locale } from "@/i18n/routing";
import { SiteHeader } from "./site-chrome";

/** The common frame of every account page: header and one card. */
export function IdShell({ locale, pathname, children }: { locale: Locale; pathname: string; children: ReactNode }) {
  return (
    <main>
      <SiteHeader locale={locale} pathname={pathname} />
      <section className="id-page">
        <div className="id-card">
          <div className="eyebrow"><span /> Sparklingstadt ID</div>
          {children}
        </div>
      </section>
    </main>
  );
}
