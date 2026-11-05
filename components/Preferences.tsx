"use client";
// Language and theme pickers (chunk 7U). Both are display settings kept in this browser only.
import { useEffect, useState } from "react";
import { LOCALES, LOCALE_NAMES, isLocale, setLocale, t, useLocale, type Locale } from "@/lib/i18n";
import { THEMES, applyTheme, currentTheme, isTheme, type Theme } from "@/lib/ui/theme";
import type { MessageKey } from "@/lib/i18n";
const THEME_LABEL: Record<Theme, MessageKey> = { system: "prefs.theme.system", light: "prefs.theme.light", dark: "prefs.theme.dark", contrast: "prefs.theme.contrast" };
/** Shown in the header. The pseudo-locale is offered only in the local test harness. */
export function Preferences({ pseudo = false, className }: { pseudo?: boolean; className?: string }) {
  const locale = useLocale(), [theme, setTheme] = useState<Theme>("system");
  useEffect(() => { setTheme(currentTheme()); }, []);
  const locales: Locale[] = pseudo ? [...LOCALES, "pseudo"] : [...LOCALES];
  return <div role="group" aria-label={t("prefs.group")} className={className} data-testid="preferences">
    <label>{t("prefs.language")}<select value={locale} data-testid="language" onChange={e => { if (isLocale(e.target.value)) setLocale(e.target.value); }}>
      {locales.map(l => <option key={l} value={l} lang={l === "pseudo" ? undefined : l}>{LOCALE_NAMES[l]}</option>)}
    </select></label>
    <label>{t("prefs.theme")}<select value={theme} data-testid="theme" onChange={e => { if (isTheme(e.target.value)) { applyTheme(e.target.value); setTheme(e.target.value); } }}>
      {THEMES.map(v => <option key={v} value={v}>{t(THEME_LABEL[v])}</option>)}
    </select></label>
  </div>;
}
