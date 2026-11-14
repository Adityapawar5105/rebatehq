"use client";
// Type-ahead for a customer or product ID (14 Nov 2026). Matches come from the vault worker's role-checked
// `search` command (ID or name contains the typed text); the field still accepts any typed ID. The list is an
// ARIA combobox: arrow keys move, Enter picks, Escape closes.
import { useEffect, useId, useRef, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { SearchHit } from "@/lib/vault/protocol";
import { uiStyles as s } from "@/components/ui/ui";

type Props = { client: VaultClient; kind: SearchHit["kind"]; label: string; value: string; onChange: (v: string) => void; required?: boolean; testId?: string; disabled?: boolean };
export function Lookup({ client, kind, label, value, onChange, required, testId, disabled }: Props) {
  const [hits, setHits] = useState<SearchHit[]>([]), [open, setOpen] = useState(false), [active, setActive] = useState(-1), [typed, setTyped] = useState(false);
  const listId = useId(), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const q = value.trim(); if (!typed || q.length < 2) { setHits([]); return; }
    let on = true; const timer = setTimeout(() => { void client.call("search", { text: q }).then(h => { if (on) { setHits(h.filter(x => x.kind === kind)); setActive(-1); } }).catch(() => { if (on) setHits([]); }); }, 150);
    return () => { on = false; clearTimeout(timer); };
  }, [client, kind, value, typed]);
  useEffect(() => { const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away); }, []);
  const pick = (h: SearchHit) => { onChange(h.id); setTyped(false); setOpen(false); setHits([]); };
  const shown = open && hits.length > 0 && !(hits.length === 1 && hits[0].id === value);
  return <div className={s.lookup} ref={box}>
    <label className={s.field}><span className={s.fieldLabel}>{label}</span>
      <input role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined} autoComplete="off"
        value={value} maxLength={160} required={required} disabled={disabled} data-testid={testId}
        onChange={e => { onChange(e.target.value); setTyped(true); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={e => {
          if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); setOpen(true); setActive(a => Math.min(hits.length - 1, a + 1)); }
          else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && shown && active >= 0) { e.preventDefault(); pick(hits[active]); }
          else if (e.key === "Escape" && shown) { e.preventDefault(); setOpen(false); }
        }}/>
    </label>
    {shown && <ul id={listId} role="listbox" className={s.lookupList}>
      {hits.map((h, i) => <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={s.lookupItem} onMouseDown={e => { e.preventDefault(); pick(h); }} onMouseEnter={() => setActive(i)}>
        <strong translate="no">{h.id}</strong>{h.label && h.label !== h.id && <span translate="no">{h.label}</span>}{h.detail && <span className={s.lookupDetail} translate="no">{h.detail}</span>}
      </li>)}
    </ul>}
  </div>;
}
