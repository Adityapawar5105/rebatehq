// Client-side i18n: the chosen language for this browser, t() and Intl formatters bound to it.
// The preference is a UI setting only (no business data): it is kept in localStorage and in a
// first-party cookie so server-rendered account pages use the same language.
import { useEffect, useSyncExternalStore } from "react";
import * as core from "./core";
import type { Locale, MessageKey, Params } from "./core";
export type { Locale, MessageKey, Params } from "./core";
export { LOCALES, LOCALE_NAMES, isLocale, msg, plainText } from "./core";

export const LOCALE_STORAGE_KEY = "rebatehq.locale";
export const LOCALE_COOKIE = "rebatehq_locale";
let current: Locale = core.DEFAULT_LOCALE;
let workspaceCurrency = "USD";
export const getWorkspaceCurrency = () => workspaceCurrency;
export function setWorkspaceCurrency(code: string) { if (code !== workspaceCurrency) { workspaceCurrency = code; for (const f of listeners) f(); } }
const listeners = new Set<() => void>();

export const getLocale = () => current;
export function setLocale(locale: Locale, persist = true) {
  if (!core.isLocale(locale) || locale === current) return;
  current = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = core.HTML_LANG[locale];
    if (persist) {
      try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* storage blocked: the choice lasts for this page */ }
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    }
  }
  for (const f of listeners) f();
}
/** The stored preference, else the browser language when it is shipped, else English. */
export function preferredLocale(): Locale {
  try { const saved = localStorage.getItem(LOCALE_STORAGE_KEY); if (core.isLocale(saved)) return saved; } catch { /* ignore */ }
  const cookie = document.cookie.split("; ").find(c => c.startsWith(LOCALE_COOKIE + "="))?.split("=")[1];
  if (core.isLocale(cookie && decodeURIComponent(cookie))) return decodeURIComponent(cookie!) as Locale;
  for (const tag of navigator.languages ?? []) {
    if (/^fr-CA$/i.test(tag)) return "fr-CA";
    const base = tag.slice(0, 2).toLowerCase();
    if (base === "es" || base === "fr") return base;
    if (base === "en") return "en";
  }
  return core.DEFAULT_LOCALE;
}
function subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
/**
 * Re-renders the calling component when the language changes. Server rendering and the first
 * client render use English (so hydration matches); the stored preference applies after mount.
 */
export function useLocale(): Locale {
  const locale = useSyncExternalStore(subscribe, getLocale, () => core.DEFAULT_LOCALE);
  useSyncExternalStore(subscribe, () => workspaceCurrency, () => "USD");
  useEffect(() => { setLocale(preferredLocale(), false); }, []);
  return locale;
}

export const t = (key: MessageKey, params?: Params) => core.translate(current, key, params);
/** Shows text that came from the vault worker (a message reference) in the current language. */
export const say = (text: string | null | undefined) => core.say(current, text);
export const fmt = {
  money: (cents: string | bigint) => core.money(current, cents),
  currency: (cents: string | bigint, code = workspaceCurrency) => core.currency(current, cents, code),
  decimal: (value: string | number | bigint, digits?: number) => core.decimal(current, value, digits),
  int: (value: string | number | bigint) => core.integer(current, value),
  percent: (value: string | number) => core.percent(current, value),
  date: (iso: string | null | undefined) => core.date(current, iso),
  dateTime: (iso: string | null | undefined) => core.dateTime(current, iso),
  month: (key: string) => core.month(current, key),
  list: (items: string[]) => core.list(current, items),
  bytes: (value: number) => core.bytes(current, value),
};
/** An error from the worker or the network, in the current language. */
export function errorText(error: unknown): string {
  return error instanceof Error && error.message ? say(error.message) : t("common.operationFailed");
}
