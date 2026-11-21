"use client";
// Shared UI components (chunk 7V). Every visible string is passed in by the caller (already translated with
// t() or say()); these components hold no text of their own. Styling comes from ui.module.css and theme tokens.
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { nextTabIndex } from "./tabKeys";
import s from "./ui.module.css";

export type Tone = "ok" | "warn" | "bad" | "info" | "accent";
const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; icon?: IconName; loading?: boolean; block?: boolean };
export function Button({ variant = "secondary", size = "md", icon, loading = false, block = false, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cx(s.btn, s[variant], size !== "md" && s[size], block && s.block, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
    {loading ? <span className={s.spinner} aria-hidden="true"/> : icon && <Icon name={icon} size={size === "sm" ? 15 : 17}/>}{children}
  </button>;
}
/** A link styled as a button (navigation, not an action). */
export function ButtonLink({ href, variant = "secondary", size = "md", icon, children, className, ...rest }: { href: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; icon?: IconName; children: ReactNode; className?: string } & HTMLAttributes<HTMLAnchorElement>) {
  return <a href={href} className={cx(s.btn, s[variant], size !== "md" && s[size], className)} {...rest}>{icon && <Icon name={icon} size={size === "sm" ? 15 : 17}/>}{children}</a>;
}

type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & { title?: ReactNode; description?: ReactNode; actions?: ReactNode; headingId?: string; flat?: boolean; children?: ReactNode; "data-testid"?: string };
/** A titled surface. The heading labels the section for assistive technology. */
export function Card({ title, description, actions, headingId, flat, className, children, ...rest }: CardProps) {
  const auto = useId(), id = headingId ?? auto;
  return <section className={cx(s.card, flat && s.flat, className)} aria-labelledby={title ? id : undefined} {...rest}>
    {(title || actions) && <div className={s.cardHead}><div>{title && <h2 id={id}>{title}</h2>}{description && <p className={s.cardDesc}>{description}</p>}</div>{actions && <div className={s.cardActions}>{actions}</div>}</div>}
    {children}
  </section>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <div className={s.pageHeader}><div>{eyebrow && <span className={s.eyebrow}>{eyebrow}</span>}<h1>{title}</h1>{description && <p className={s.pageDesc}>{description}</p>}</div>{actions && <div className={s.cardActions}>{actions}</div>}</div>;
}

/** Auto-fitting grid; `min` is the smallest column width in px. */
export function Grid({ min = 220, children, className, ...rest }: { min?: number; children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(s.grid, className)} style={{ ["--grid-min" as string]: `${min}px` }} {...rest}>{children}</div>;
}
export function Split({ children }: { children: ReactNode }) { return <div className={s.split}>{children}</div>; }

type StatProps = { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: IconName; tone?: Tone; /** Long values (money) take a full row on phones. */ wide?: boolean; valueProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string> };
/** One key number. `valueProps` carries test ids and raw values (data-value) on the number itself. */
export function StatTile({ label, value, hint, icon, tone, wide, valueProps }: StatProps) {
  return <div className={s.stat} data-tone={tone} data-wide={wide ? "yes" : undefined}>
    <span className={s.statLabel}>{icon && <span className={s.statIcon}><Icon name={icon} size={16}/></span>}{label}</span>
    <strong className={s.statValue} style={typeof value === "string" ? { ["--len" as string]: Math.max(4, value.length) } : undefined} {...valueProps}>{value}</strong>
    {hint && <span className={s.statHint}>{hint}</span>}
  </div>;
}

export function Badge({ tone = "info", icon, children, ...rest }: { tone?: Tone; icon?: IconName; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={s.badge} data-tone={tone} {...rest}>{icon && <Icon name={icon} size={13}/>}{children}</span>;
}

const NOTICE_ICON: Record<Tone, IconName> = { ok: "checkCircle", warn: "alert", bad: "alert", info: "info", accent: "info" };
/** A tinted message strip. Pass role="alert" or role="status" when it announces a change. */
export function Notice({ tone = "info", title, actions, children, className, ...rest }: { tone?: Tone; title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string>) {
  return <div className={cx(s.notice, className)} data-tone={tone} {...rest}>
    <Icon name={NOTICE_ICON[tone]} size={18}/>
    <div className={s.noticeBody}>{title && <strong>{title} </strong>}{children}{actions && <div className={s.noticeActions}>{actions}</div>}</div>
  </div>;
}

/** A checkbox with its label on the same line and an optional one-line hint under it (roadmap 8.16). */
export function Checkbox({ label, hint, className, ...rest }: { label: ReactNode; hint?: ReactNode; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & Record<`data-${string}`, string>) {
  const hintId = useId();
  return <div className={cx(s.check, className)}><label className={s.checkLabel}><input type="checkbox" aria-describedby={hint ? hintId : undefined} {...rest}/><span>{label}</span></label>{hint && <span id={hintId} className={s.fieldHint}>{hint}</span>}</div>;
}

/** A label wrapping its control, so the visible label is the accessible name. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cx(s.field, className)}><span className={s.fieldLabel}>{label}</span>{children}{hint && <span className={s.fieldHint}>{hint}</span>}{error && <span className={s.fieldError} role="alert">{error}</span>}</label>;
}

export function DataTable({ caption, children, label }: { caption?: ReactNode; label?: string; children: ReactNode }) {
  return <div className={s.tableWrap} role={label ? "region" : undefined} aria-label={label} tabIndex={label ? 0 : undefined}><table className={s.table} aria-label={label}>{caption && <caption>{caption}</caption>}{children}</table></div>;
}
export const numCell = s.num;

export function EmptyState({ icon = "sparkle", title, body, action }: { icon?: IconName; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return <div className={s.empty}><span className={s.emptyIcon}><Icon name={icon} size={22}/></span><h3>{title}</h3>{body && <p>{body}</p>}{action}</div>;
}
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} className={s.skeleton} style={{ width: `${100 - i * 15}%` }}/>)}</div>;
}

/** A labelled progress bar; the native <progress> keeps the value for assistive technology. */
export function Meter({ value, max, label, detail }: { value: number; max: number; label: ReactNode; detail?: ReactNode }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0, id = useId();
  return <div className={s.meter}>
    <div className={s.meterText}><span id={id}>{label}</span>{detail && <span>{detail}</span>}</div>
    <div className={s.meterTrack} aria-hidden="true"><div className={s.meterFill} style={{ width: `${pct}%` }}/></div>
    <progress className={s.srOnly} value={value} max={max} aria-labelledby={id}/>
  </div>;
}

/** Section tabs that are links (hash or route), so each view keeps its own URL. */
export function SectionTabs({ items, current, label, onSelect }: { items: { id: string; label: ReactNode; href: string; icon?: IconName;testId?:string }[]; current: string; label: string; onSelect?: (id: string) => void }) {
  return <nav className={s.tabs} aria-label={label}>{items.map(i => <a key={i.id} href={i.href} data-testid={i.testId} className={s.tab} aria-current={i.id === current ? "page" : undefined} onClick={() => onSelect?.(i.id)}>{i.icon && <Icon name={i.icon} size={16}/>}{i.label}</a>)}</nav>;
}

/** In-page tabs (roadmap 8.1): one tab list pattern with roving focus and Left/Right/Home/End keys. The caller renders
 *  the active panel and gives it `tabPanelProps(idPrefix, active)`, so each tab is tied to its panel. */
export function Tabs<T extends string>({ label, tabs, active, onChange, idPrefix, className }: { label: string; tabs: { id: T; label: ReactNode; count?: ReactNode; testId?: string }[]; active: T; onChange: (id: T) => void; idPrefix: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: KeyboardEvent<HTMLButtonElement>, i: number) => { const n = nextTabIndex(e.key, i, tabs.length); if (n === null) return; e.preventDefault(); onChange(tabs[n].id); refs.current[n]?.focus(); };
  return <div role="tablist" aria-label={label} className={cx(s.tabs, className)}>{tabs.map((x, i) => <button key={x.id} ref={el => { refs.current[i] = el; }} type="button" role="tab" id={`${idPrefix}-tab-${x.id}`} aria-selected={x.id === active} aria-controls={`${idPrefix}-panel`} tabIndex={x.id === active ? 0 : -1} className={s.tab} data-testid={x.testId} onClick={() => onChange(x.id)} onKeyDown={e => key(e, i)}>
    {x.label}{x.count !== undefined && <span className={s.tabCount}>{x.count}</span>}
  </button>)}</div>;
}
export const tabPanelProps = (idPrefix: string, active: string) => ({ role: "tabpanel" as const, id: `${idPrefix}-panel`, "aria-labelledby": `${idPrefix}-tab-${active}` });

/** "On this page" bar: scrolls to a card heading without changing the section in the URL. */
export function JumpNav({ label, items, jumpLabel }: { label: string; items: { id: string; label: string; icon?: IconName }[]; jumpLabel: (name: string) => string }) {
  const go = (id: string) => { const el = document.getElementById(id); if (!el) return; const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); };
  return <nav className={s.jump} aria-label={label}>{items.map(i => <button key={i.id} type="button" className={s.jumpItem} aria-label={jumpLabel(i.label)} onClick={() => go(i.id)}>{i.icon && <Icon name={i.icon} size={15}/>}{i.label}</button>)}</nav>;
}

export type Step = { id: string; title: ReactNode; meta?: ReactNode; done: boolean; actions?: ReactNode; "data-testid"?: string };
export function StepList({ steps }: { steps: Step[] }) {
  return <ol className={s.steps}>{steps.map(st => <li key={st.id} className={s.step} data-done={st.done ? "yes" : "no"} data-testid={st["data-testid"]}>
    <span className={s.stepMark}><Icon name={st.done ? "check" : "circle"} size={15}/></span>
    <div><div className={s.stepTitle}>{st.title}</div>{st.meta && <div className={s.stepMeta}>{st.meta}</div>}</div>
    {st.actions && <div className={s.stepActions}>{st.actions}</div>}
  </li>)}</ol>;
}

/** Native modal dialog: focus moves in, Escape closes, the page behind is inert. */
export function Dialog({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} className={s.dialog} aria-labelledby={labelledBy} onClose={onClose}>{children}</dialog>;
}

export function SrOnly({ children }: { children: ReactNode }) { return <span className={s.srOnly}>{children}</span>; }
export const uiStyles = s;
