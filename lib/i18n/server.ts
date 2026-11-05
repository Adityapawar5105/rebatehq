// Server components: the language from the preference cookie, else Accept-Language, else English.
import { cookies, headers } from "next/headers";
import * as core from "./core";
import type { Locale, MessageKey, Params } from "./core";

export const LOCALE_COOKIE = "rebatehq_locale";
export function localeFrom(cookie: string | undefined, acceptLanguage: string | null): Locale {
  const saved = cookie ? decodeURIComponent(cookie) : "";
  if (core.isLocale(saved)) return saved;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim();
    if (/^fr-CA$/i.test(tag)) return "fr-CA";
    const base = tag.slice(0, 2).toLowerCase();
    if (base === "es" || base === "fr") return base;
    if (base === "en") return "en";
  }
  return core.DEFAULT_LOCALE;
}
export async function serverLocale(): Promise<Locale> {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  return localeFrom(jar.get(LOCALE_COOKIE)?.value, list.get("accept-language"));
}
/** t() for one server render; never shared between requests. */
export async function serverT() {
  const locale = await serverLocale();
  return Object.assign((key: MessageKey, params?: Params) => core.translate(locale, key, params), { locale, lang: core.HTML_LANG[locale] });
}
