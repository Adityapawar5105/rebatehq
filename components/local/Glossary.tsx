"use client";
// Finance glossary (chunk 7U): plain-language definitions of fixed terms, in every shipped
// language. <Term> adds a small explain button beside a number or heading; the definition
// opens inline (keyboard: Enter/Space to open, Escape to close). Definitions never contain data.
import { useEffect, useId, useRef, useState } from "react";
import { t, type MessageKey } from "@/lib/i18n";
import styles from "./vault.module.css";

import { TERMS, type TermId } from "@/lib/ui/glossary";
const TERM_KEY = Object.fromEntries(TERMS.map(id => [id, [`glossary.${id}`, `glossary.${id}.def`]])) as unknown as Record<TermId, [MessageKey, MessageKey]>;
export const termName = (id: TermId) => t(TERM_KEY[id][0]);
export const termDefinition = (id: TermId) => t(TERM_KEY[id][1]);

/** An explain button for one glossary term, shown beside a label or value. */
export function Term({ id, children }: { id: TermId; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false), panel = useId(), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [open]);
  return <span className={styles.term}>{children}<button ref={button} type="button" className={styles.termButton} aria-expanded={open} aria-controls={panel} aria-label={t("glossary.explain", { term: termName(id) })} onClick={() => setOpen(o => !o)}>?</button>
    {open && <span id={panel} role="note" className={styles.termPanel} data-testid={`term-${id}`}><strong>{termName(id)}</strong>{t("common.definitionSeparator")}{termDefinition(id)}</span>}
  </span>;
}

/** The whole glossary, for every role (it explains words, never numbers). */
export function GlossaryCard() {
  return <details className={styles.card} id="glossary" data-testid="glossary"><summary><h2 className={styles.inlineHeading}>{t("glossary.heading")}</h2></summary>
    <p className={styles.muted}>{t("glossary.intro")}</p>
    <dl className={styles.glossary}>{TERMS.map(id => <div key={id}><dt>{termName(id)}</dt><dd>{termDefinition(id)}</dd></div>)}</dl>
  </details>;
}
