import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ja", "zh-cn", "zh-tw"],
  defaultLocale: "ja",
  localePrefix: "as-needed",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

export const htmlLanguages: Record<Locale, string> = {
  ja: "ja",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
};

export const openGraphLocales: Record<Locale, string> = {
  ja: "ja_JP",
  "zh-cn": "zh_CN",
  "zh-tw": "zh_TW",
};
