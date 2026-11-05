// Theme preference (chunk 7U): a UI setting only, kept in a first-party cookie so the server
// renders the right theme without a flash, and in localStorage as a fallback.
export const THEMES = ["system", "light", "dark", "contrast"] as const;
export type Theme = typeof THEMES[number];
export const THEME_COOKIE = "rebatehq_theme";
export const isTheme = (value: unknown): value is Theme => typeof value === "string" && (THEMES as readonly string[]).includes(value);
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "system";
  const value = document.documentElement.dataset.theme;
  return isTheme(value) ? value : "system";
}
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme; else root.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  window.dispatchEvent(new CustomEvent("rebatehq-theme", { detail: theme }));
}
