"use client";
// Command palette (chunk 7U): Ctrl/Cmd+K opens a list of screens, commands and matching
// SKUs and customers. Typing only filters that list; there is no free-text command
// language. Product and customer hits come from the vault worker's role-checked `search`
// command, which returns IDs and names only (never cost or price).
import { useEffect, useMemo, useRef, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { SearchHit } from "@/lib/vault/protocol";
import type { Cap } from "@/lib/roles/access";
import { LOCALES, LOCALE_NAMES, setLocale, t, type Locale } from "@/lib/i18n";
import { THEMES, applyTheme, type Theme } from "@/lib/ui/theme";
import type { Section } from "./VaultApp";
import { SECTION_LABEL } from "./VaultApp";
import styles from "./vault.module.css";

type Item = { id: string; group: "screen" | "command" | "product" | "customer"; label: string; detail?: string; run: () => void };
const THEME_KEY = { system: "prefs.theme.system", light: "prefs.theme.light", dark: "prefs.theme.dark", contrast: "prefs.theme.contrast" } as const;
export const MARGIN_FILTER_EVENT = "rebatehq-margin-filter";
export const OPEN_PALETTE_EVENT = "rebatehq-open-palette";

export function CommandPalette({ client, caps, sections, go, commands }: { client: VaultClient | null; caps: Cap[]; sections: readonly Section[]; go: (s: Section) => void; commands: { lock?: () => void; save?: () => void } }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [hits, setHits] = useState<SearchHit[]>([]), [active, setActive] = useState(0), [picked, setPicked] = useState<SearchHit | null>(null);
  const input = useRef<HTMLInputElement>(null), opener = useRef<Element | null>(null), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); opener.current = document.activeElement; setOpen(o => !o); } };
    const show = () => { opener.current = document.activeElement; setOpen(true); };
    window.addEventListener("keydown", key); window.addEventListener(OPEN_PALETTE_EVENT, show);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener(OPEN_PALETTE_EVENT, show); };
  }, []);
  useEffect(() => {
    const d = dialog.current; if (!d) return;
    if (open && !d.open) { d.showModal(); setQuery(""); setHits([]); setActive(0); setPicked(null); setTimeout(() => input.current?.focus(), 0); }
    if (!open && d.open) { d.close(); (opener.current as HTMLElement | null)?.focus?.(); }
  }, [open]);
  useEffect(() => {
    if (!open || !client || query.trim().length < 2) { setHits([]); return; }
    let on = true; const timer = setTimeout(() => { void client.call("search", { text: query.trim() }).then(h => { if (on) setHits(h); }).catch(() => { if (on) setHits([]); }); }, 150);
    return () => { on = false; clearTimeout(timer); };
  }, [client, open, query]);
  const close = () => setOpen(false);
  const items = useMemo<Item[]>(() => {
    const list: Item[] = sections.map(s => ({ id: "screen:" + s, group: "screen", label: t(SECTION_LABEL[s]), run: () => { go(s); close(); } }));
    list.push({ id: "cmd:glossary", group: "command", label: t("palette.glossary"), run: () => { go("Home"); close(); setTimeout(() => { const g = document.getElementById("glossary") as HTMLDetailsElement | null; if (g) { g.open = true; g.scrollIntoView(); g.querySelector("summary")?.focus(); } }, 50); } });
    if (commands.save) list.push({ id: "cmd:save", group: "command", label: t("shell.retrySave"), run: () => { commands.save!(); close(); } });
    if (commands.lock) list.push({ id: "cmd:lock", group: "command", label: t("shell.lock"), run: () => { commands.lock!(); close(); } });
    for (const l of LOCALES) list.push({ id: "lang:" + l, group: "command", label: t("palette.language", { language: LOCALE_NAMES[l as Locale] }), run: () => { setLocale(l); close(); } });
    for (const th of THEMES) list.push({ id: "theme:" + th, group: "command", label: t("palette.theme", { theme: t(THEME_KEY[th as Theme]) }), run: () => { applyTheme(th); close(); } });
    const q = query.trim().toLocaleLowerCase();
    const shown = q ? list.filter(i => i.label.toLocaleLowerCase().includes(q)) : list;
    const lookup = (h: SearchHit): Item => ({ id: `${h.kind}:${h.id}`, group: h.kind, label: h.id, detail: [h.label, h.detail].filter(Boolean).join(" · "), run: () => {
      if (caps.includes("cost") && sections.includes("Margin")) { go("Margin"); close(); window.dispatchEvent(new CustomEvent(MARGIN_FILTER_EVENT, { detail: { dim: h.kind, value: h.id } })); }
      else setPicked(h);
    } });
    return [...shown, ...hits.map(lookup)];
  }, [sections, commands.lock, commands.save, query, hits, caps]);
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);
  const GROUP = { screen: t("palette.group.screens"), command: t("palette.group.commands"), product: t("palette.group.products"), customer: t("palette.group.customers") };
  return <dialog ref={dialog} className={styles.palette} aria-labelledby="palette-title" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} data-testid="command-palette">
    <h2 id="palette-title" className={styles.srOnly}>{t("palette.title")}</h2>
    <input ref={input} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `palette-${active}` : undefined} aria-autocomplete="list" aria-label={t("palette.search")} placeholder={t("palette.placeholder")} value={query} maxLength={80}
      onChange={e => { setQuery(e.target.value); setActive(0); setPicked(null); }}
      onKeyDown={e => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
        else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
      }}/>
    <p className={styles.small}>{t(client ? "palette.hint" : "palette.hintLocked")}</p>
    <ul id="palette-list" role="listbox" aria-label={t("palette.results")} className={styles.paletteList}>
      {items.map((item, i) => <li key={item.id} id={`palette-${i}`} role="option" aria-selected={i === active} className={i === active ? styles.paletteActive : undefined} onMouseEnter={() => setActive(i)} onClick={() => item.run()}>
        <span className={styles.small}>{GROUP[item.group]}</span> <strong translate={item.group === "product" || item.group === "customer" ? "no" : undefined}>{item.label}</strong>{item.detail && <span className={styles.muted} translate="no"> · {item.detail}</span>}
      </li>)}
      {!items.length && <li role="option" aria-selected="false" aria-disabled="true">{t("palette.noMatches")}</li>}
    </ul>
    {picked && <p role="status" className={styles.notice}>{t(picked.kind === "product" ? "palette.productFound" : "palette.customerFound", { id: picked.id, detail: [picked.label, picked.detail].filter(Boolean).join(" · ") || t("common.none") })}</p>}
    <p className={styles.small}><button type="button" onClick={close}>{t("common.close")}</button> {t("palette.keys")}</p>
  </dialog>;
}
