import { getPathname } from "@/i18n/navigation";
import { htmlLanguages, routing, type Locale } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/id/session";
import { getTranslations } from "next-intl/server";

const languageLabels: Record<Locale, string> = {
  ja: "日本語",
  "zh-cn": "简体",
  "zh-tw": "繁體",
};

type SiteHeaderProps = {
  locale: Locale;
  /** 言語切替で同じページを開くための、ロケールを除いたパス */
  pathname: string;
};

export async function SiteHeader({ locale, pathname }: SiteHeaderProps) {
  const t = await getTranslations({ locale, namespace: "Header" });
  const current = await getCurrentUser();

  return (
    <header className="site-header">
      <a className="brand" href={getPathname({ href: "/account", locale })} aria-label={t("homeAriaLabel")}>
        <span className="brand-mark" aria-hidden="true">S</span>
        <span>
          <strong>Sparklingstadt ID</strong>
        </span>
      </a>
      <div className="header-tools">
        {current ? <span className="header-user">{current.user.name}</span> : null}
        <div className="language-switcher" aria-label={t("language")}>
          {routing.locales.map((language) => (
            <a
              key={language}
              href={getPathname({ href: pathname, locale: language })}
              hrefLang={htmlLanguages[language]}
              lang={htmlLanguages[language]}
              aria-current={locale === language ? "page" : undefined}
            >
              {languageLabels[language]}
            </a>
          ))}
        </div>
      </div>
    </header>
  );
}
