"use client";
// Command palette (chunk 7U): Ctrl/Cmd+K opens a list of screens, commands and matching
// SKUs and customers. Typing only filters that list; there is no free-text command
// language. Product and customer hits come from the vault worker's role-checked `search`
// command, which returns IDs and names only (never cost or price).
// 15 Nov 2026 (user request): with nothing typed, the palette shows only what you opened
// recently and four key actions; typing still searches every screen, command, SKU and customer.
// Recent screens and commands are layout preferences and stay in this browser; recent SKUs and
// customers are vault data, so they live in memory only and are forgotten when the vault locks
// or the role changes.
import { scrollToHeading } from "./scroll";
import { useEffect, useMemo, useRef, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { SearchHit, Tier } from "@/lib/vault/protocol";
import type { Cap } from "@/lib/roles/access";
import { LOCALES, LOCALE_NAMES, setLocale, t, type Locale } from "@/lib/i18n";
import { THEMES, applyTheme, type Theme } from "@/lib/ui/theme";
import type { Section } from "./VaultApp";
import { SECTION_LABEL } from "./VaultApp";
import { matches, visibleSubTabs, type SubTab } from "./subtabs";
import styles from "./vault.module.css";

type Group = "screen" | "tab" | "command" | "product" | "customer";
type Item = { id: string; group: Group; label: string; detail?: string; run: () => void };
type Row = Item & { heading?: "recent" | "suggested" | Group };
// Typed results are grouped in this order, each under its own heading (20 Nov 2026).
const GROUP_ORDER: readonly Group[] = ["screen", "tab", "command", "product", "customer"];
const THEME_KEY = { system: "prefs.theme.system", light: "prefs.theme.light", dark: "prefs.theme.dark", contrast: "prefs.theme.contrast" } as const;
export const MARGIN_FILTER_EVENT = "rebatehq-margin-filter";
export const OPEN_PALETTE_EVENT = "rebatehq-open-palette";
/** The key actions shown with an empty query, in priority order; the first four this role has are shown. */
export const SUGGESTED = ["screen:Quotes", "screen:Data Hub", "screen:Margin", "screen:Pricing", "screen:Reports", "cmd:glossary", "screen:Settings"] as const;
export const SUGGESTED_COUNT = 4, RECENT_COUNT = 5;
const isHit = (id: string) => id.startsWith("product:") || id.startsWith("customer:");
/** Opens a sub-tab by its hash (re-firing it when already there, since a tab button may have moved off it) or scrolls to a section heading. */
function openSubTab(s: SubTab, go: (s: Section) => void) {
  if (s.hash) { if (location.hash === "#" + s.hash) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = s.hash; return; }
  // A heading lives on one sub-page (23 Nov 2026): open that page, then scroll to it.
  if (s.page && location.hash !== "#" + s.page) location.hash = s.page; else go(s.section);
  const anchor = s.anchor ?? "";
  setTimeout(() => scrollToHeading(anchor), 50);
}
function readRecent(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !isHit(x)).slice(0, RECENT_COUNT) : []; } catch { return []; }
}

export function CommandPalette({ client, caps, tier, sections, go, commands, storageKey }: { client: VaultClient | null; caps: Cap[]; tier: Tier | undefined; sections: readonly Section[]; go: (s: Section) => void; commands: { lock?: () => void; save?: () => void }; storageKey: string }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [hits, setHits] = useState<SearchHit[]>([]), [active, setActive] = useState(0), [picked, setPicked] = useState<SearchHit | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const recentHits = useRef(new Map<string, SearchHit>());
  const input = useRef<HTMLInputElement>(null), opener = useRef<Element | null>(null), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setRecent(readRecent(storageKey)); }, [storageKey]);
  // Recent SKUs and customers never outlive the unlocked vault or the role that found them.
  const capsKey = caps.join(",");
  useEffect(() => { recentHits.current.clear(); setRecent(r => r.filter(id => !isHit(id))); }, [client, capsKey]);
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
  const remember = (id: string, hit?: SearchHit) => {
    if (hit) recentHits.current.set(id, hit);
    setRecent(r => {
      const next = [id, ...r.filter(x => x !== id)].slice(0, RECENT_COUNT);
      try { localStorage.setItem(storageKey, JSON.stringify(next.filter(x => !isHit(x)))); } catch { /* storage blocked: recents last for this page */ }
      return next;
    });
  };
  const clearRecent = () => { recentHits.current.clear(); setRecent([]); try { localStorage.removeItem(storageKey); } catch { /* ignore */ } input.current?.focus(); };
  const items = useMemo<Row[]>(() => {
    const list: Item[] = sections.map(s => ({ id: "screen:" + s, group: "screen", label: t(SECTION_LABEL[s]), run: () => { go(s); close(); } }));
    // Sub-tabs and on-page sections this role can open (e.g. "Purchase receipts" in Rebates & Contracts).
    for (const s of visibleSubTabs(sections, { caps, tier })) list.push({ id: `tab:${s.section}:${s.id}`, group: "tab", label: t(s.label), detail: t(SECTION_LABEL[s.section]), run: () => { close(); openSubTab(s, go); } });
    const home = sections.includes("Settings") ? "Settings" : null;
    if (home) list.push({ id: "cmd:glossary", group: "command", label: t("palette.glossary"), run: () => { go(home); close(); setTimeout(() => { const g = document.getElementById("glossary") as HTMLDetailsElement | null; if (g) { g.open = true; g.scrollIntoView(); g.querySelector("summary")?.focus(); } }, 50); } });
    if (commands.save) list.push({ id: "cmd:save", group: "command", label: t("shell.retrySave"), run: () => { commands.save!(); close(); } });
    if (commands.lock) list.push({ id: "cmd:lock", group: "command", label: t("shell.lock"), run: () => { commands.lock!(); close(); } });
    for (const l of LOCALES) list.push({ id: "lang:" + l, group: "command", label: t("palette.language", { language: LOCALE_NAMES[l as Locale] }), run: () => { setLocale(l); close(); } });
    for (const th of THEMES) list.push({ id: "theme:" + th, group: "command", label: t("palette.theme", { theme: t(THEME_KEY[th as Theme]) }), run: () => { applyTheme(th); close(); } });
    const lookup = (h: SearchHit): Item => ({ id: `${h.kind}:${h.id}`, group: h.kind, label: h.id, detail: [h.label, h.detail, h.note ? t("notes.paletteNote", { text: h.note }) : ""].filter(Boolean).join(" · "), run: () => {
      if (caps.includes("cost") && sections.includes("Margin")) { go("Margin"); close(); window.dispatchEvent(new CustomEvent(MARGIN_FILTER_EVENT, { detail: { dim: h.kind, value: h.id } })); }
      // A Sales Rep (quotes, no cost) goes to Price Check with the SKU or customer filled in.
      else if (caps.includes("quote") && tier !== "starter" && sections.includes("Quotes")) { close(); const hash = `quotes-check-${h.kind}-${encodeURIComponent(h.id)}`; if (location.hash === "#" + hash) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = hash; }
      else setPicked(h);
    } });
    const track = (i: Item, hit?: SearchHit): Item => ({ ...i, run: () => { remember(i.id, hit); i.run(); } });
    const q = query.trim().toLocaleLowerCase();
    if (q) {
      const found = [...list.filter(i => matches(i.group === "tab" ? `${i.label} ${i.detail}` : i.label, q)).map(i => track(i)), ...hits.map(h => track(lookup(h), h))];
      return GROUP_ORDER.flatMap(g => found.filter(i => i.group === g).map((i, n): Row => n === 0 ? { ...i, heading: g } : i));
    }
    // Nothing typed: what you opened recently, then the first four key actions you have.
    const byId = new Map(list.map(i => [i.id, i]));
    const recentRows = recent.flatMap(id => { const hit = recentHits.current.get(id), item = hit ? lookup(hit) : byId.get(id); return item ? [track(item, hit)] : []; });
    const suggested = SUGGESTED.flatMap(id => { const item = byId.get(id); return item && !recent.includes(id) ? [track(item)] : []; }).slice(0, SUGGESTED_COUNT);
    return [...recentRows.map((r, i): Row => i === 0 ? { ...r, heading: "recent" } : r), ...suggested.map((r, i): Row => i === 0 ? { ...r, heading: "suggested" } : r)];
  }, [sections, commands.lock, commands.save, query, hits, caps, tier, recent]);
  useEffect(() => { setActive(a => Math.min(a, Math.max(0, items.length - 1))); }, [items.length]);
  // Keep the highlighted row visible while moving with the arrow keys (20 Nov 2026).
  useEffect(() => { if (open) document.getElementById(`palette-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  const GROUP_HEADING: Record<Group, string> = { screen: t("palette.heading.screens"), tab: t("palette.heading.tabs"), command: t("palette.heading.commands"), product: t("palette.heading.products"), customer: t("palette.heading.customers") };
  const GROUP = { screen: t("palette.group.screens"), tab: t("palette.group.tabs"), command: t("palette.group.commands"), product: t("palette.group.products"), customer: t("palette.group.customers") };
  const empty = !query.trim();
  return <dialog ref={dialog} className={styles.palette} aria-labelledby="palette-title" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} data-testid="command-palette">
    <h2 id="palette-title" className={styles.srOnly}>{t("palette.title")}</h2>
    <input ref={input} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `palette-${active}` : undefined} aria-autocomplete="list" aria-label={t("palette.search")} placeholder={t("palette.placeholder")} value={query} maxLength={80}
      onChange={e => { setQuery(e.target.value); setActive(0); setPicked(null); }}
      onKeyDown={e => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
        else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
      }}/>
    <p className={styles.small}>{t(client ? (empty ? "palette.hintEmpty" : "palette.hint") : "palette.hintLocked")}</p>
    <ul id="palette-list" role="listbox" aria-label={t("palette.results")} className={styles.paletteList}>
      {items.map((item, i) => [
        item.heading && <li key={"h:" + item.heading} role="presentation" className={styles.paletteHeading} data-testid={`palette-${item.heading}`}>
          {item.heading === "recent" ? t("palette.recent") : item.heading === "suggested" ? t("palette.suggested") : GROUP_HEADING[item.heading]}
          {item.heading === "recent" && <button type="button" className={styles.paletteClear} onClick={clearRecent}>{t("palette.clearRecent")}</button>}
        </li>,
        <li key={item.id} id={`palette-${i}`} role="option" aria-selected={i === active} className={i === active ? styles.paletteActive : undefined} onMouseEnter={() => setActive(i)} onClick={() => item.run()}>
          <span className={styles.small}>{GROUP[item.group]}</span> <strong translate={item.group === "product" || item.group === "customer" ? "no" : undefined}>{item.label}</strong>{item.detail && <span className={styles.muted} translate={item.group === "product" || item.group === "customer" ? "no" : undefined}> · {item.detail}</span>}
        </li>,
      ])}
      {!items.length && <li role="option" aria-selected="false" aria-disabled="true">{t("palette.noMatches")}</li>}
    </ul>
    {picked && <p role="status" className={styles.notice}>{t(picked.kind === "product" ? "palette.productFound" : "palette.customerFound", { id: picked.id, detail: [picked.label, picked.detail].filter(Boolean).join(" · ") || t("common.none") })}</p>}
    <p className={styles.small}><button type="button" onClick={close}>{t("common.close")}</button> {t("palette.keys")}</p>
  </dialog>;
}
