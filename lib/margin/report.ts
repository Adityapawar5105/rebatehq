// Margin Leak Report: a client-side PDF built in the vault worker from the leak finder,
// the waterfall and the ROI ledger. It is handed to the page as a Blob; nothing is uploaded.
// Chunk 7U: every sentence comes from a message key and every number, amount and date is
// formatted with Intl in the user's language (the finder's own text is a message reference).
// Layout (14 Nov 2026): an owner's first page (headline numbers, what needs attention first with
// a recommended action, where the margin leaks by type), then the waterfall, every finding in
// scope, the evidence lines and the method. A selection on screen limits the report to those findings.
import { Pdf, type Color } from "./pdf";
import type { Finding, LeakResult, LeakRow, LeakType } from "./leaks";
import { RULES } from "./leaks";
import type { Waterfall } from "./views";
import type { RoiSummary } from "./roi";
import { currency, dateTime, date, integer, percent, say, translate, type Locale, type MessageKey, type Params } from "../i18n/core";
export type ReportScope = { chosen: number; of: number; affectedLines: string };
export type ReportInput = { currency?: string; locale?: Locale; generatedAt: string; sample: boolean; lines: string; from: string | null; to: string | null; sources: string[]; waterfall: Waterfall; leaks: LeakResult; roi: RoiSummary; evidence: Record<string, LeakRow[]>; scope?: ReportScope };
const INK: Color = [0.1, 0.1, 0.12], MUTED: Color = [0.4, 0.41, 0.45], ACCENT: Color = [0.07, 0.27, 0.5], NAVY: Color = [0.05, 0.16, 0.32], WHITE: Color = [1, 1, 1], SOFT: Color = [0.82, 0.88, 0.95];
const LOSS: Color = [0.7, 0.16, 0.12], BAR: Color = [0.78, 0.85, 0.93], LOSS_BAR: Color = [0.93, 0.76, 0.73], PANEL: Color = [0.955, 0.962, 0.972], RULE: Color = [0.86, 0.87, 0.9];
const PRIORITY = { high: { key: "report.priority.high", color: [0.7, 0.16, 0.12] }, medium: { key: "report.priority.medium", color: [0.78, 0.47, 0.05] }, low: { key: "report.priority.low", color: [0.38, 0.42, 0.48] } } as const satisfies Record<string, { key: MessageKey; color: Color }>;
type Priority = keyof typeof PRIORITY;
/** What an owner should do about each kind of finding (message keys, so every language has its own sentence). */
const ACTION: Record<LeakType, MessageKey> = {
  below_cost: "report.action.belowCost", negative_margin: "report.action.negativeMargin", unrecovered_freight: "report.action.freight", discount_outlier: "report.action.discountOutlier",
  below_lower_tier: "report.action.lowerTier", below_floor: "report.action.belowFloor", small_order_loss: "report.action.smallOrder", free_delivery_loss: "report.action.freeDelivery",
};
const actionKey = (f: Finding): MessageKey => f.id === "negative_margin|cost_rise" ? "report.action.costRise" : ACTION[f.type];
/** Share a/b as a percent with one decimal, exactly (half up); null when b is not positive. */
function share(a: bigint, b: bigint): string | null {
  if (b <= BigInt(0)) return null;
  const neg = a < BigInt(0), x = neg ? -a : a, tenths = (x * BigInt(1000) + b / BigInt(2)) / b;
  return `${neg ? "-" : ""}${tenths / BigInt(10)}.${tenths % BigInt(10)}`;
}
const priorityOf = (cents: bigint, total: bigint): Priority => total <= BigInt(0) ? "low" : cents * BigInt(4) >= total ? "high" : cents * BigInt(10) >= total ? "medium" : "low";

export function leakReport(r: ReportInput): Uint8Array {
  const locale: Locale = r.locale ?? "en";
  const tr = (key: MessageKey, params?: Params) => translate(locale, key, params), $ = (cents: string | bigint) => currency(locale, cents, r.currency ?? "USD"), n = (v: string | number) => integer(locale, v), text = (s: string) => say(locale, s);
  const pct = (v: string | null) => v === null ? tr("common.notApplicable") : percent(locale, v);
  const pdf = new Pdf(), L = 48, R = pdf.width - 48, W = R - L, TOP = pdf.height - 64, BOTTOM = 64;
  const leaks = r.leaks, findings = [...leaks.findings].sort((a, b) => BigInt(b.cents) > BigInt(a.cents) ? 1 : BigInt(b.cents) < BigInt(a.cents) ? -1 : a.id < b.id ? -1 : 1);
  const sumOf = BigInt(leaks.totalCents), headline = BigInt(leaks.dedupedCents), w = r.waterfall, pocket = BigInt(w.netPocket);
  let y = 0;
  const newPage = () => { pdf.page(); y = TOP; pdf.text(L, pdf.height - 40, tr("report.marginLeakReport"), 8, true, MUTED); pdf.line(L, pdf.height - 46, R, pdf.height - 46, RULE); };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  /** Wrapped paragraph; returns nothing, moves y. */
  const para = (s: string, size = 9, color: Color = INK, bold = false, x = L, max = R - x) => { for (const line of Pdf.wrap(s, size, max)) { need(size + 4); pdf.text(x, y, line, size, bold, color); y -= size * 1.4; } };
  const heading = (s: string, room = 48) => { need(room); y -= 6; pdf.rect(L, y - 3, 3, 15, ACCENT); pdf.text(L + 10, y, s, 13, true, INK); y -= 22; };
  const pill = (x: number, yy: number, p: Priority) => { const label = tr(PRIORITY[p].key), wd = Pdf.widthOf(label, 7) + 10; pdf.rect(x, yy - 3, wd, 11, PRIORITY[p].color); pdf.text(x + 5, yy, label, 7, true, WHITE); return wd; };
  /** Largest font size (down to 9) at which `s` fits in `max` points. */
  const sizeFor = (s: string, size: number, max: number) => { let z = size; while (z > 9 && Pdf.widthOf(s, z) > max) z -= 0.5; return z; };

  // ---------------------------------------------------------------- Page 1: the owner's summary
  pdf.page();
  pdf.rect(0, pdf.height - 96, pdf.width, 96, NAVY);
  pdf.text(L, pdf.height - 46, tr("report.marginLeakReport"), 24, true, WHITE);
  pdf.text(L, pdf.height - 64, Pdf.fit(tr("report.generated", { when: dateTime(locale, r.generatedAt, true) }), 8.5, W), 8.5, false, SOFT);
  pdf.text(L, pdf.height - 78, Pdf.fit(tr(r.from ? "report.linesRangeSources" : "report.linesSources", { count: Number(r.lines), from: date(locale, r.from), to: date(locale, r.to), sources: r.sources.join(", ") }), 8.5, W), 8.5, false, SOFT);
  y = pdf.height - 120;
  if (r.sample) { pdf.rect(L, y - 6, W, 18, [0.99, 0.93, 0.91]); pdf.text(L + 8, y, Pdf.fit(tr("report.sampleBanner"), 8.5, W - 16), 8.5, true, LOSS); y -= 26; }
  const scope = r.scope;
  para(scope && scope.chosen < scope.of ? tr("report.scopeSelected", { chosen: n(scope.chosen), total: n(scope.of) }) : tr("report.scopeAll", { count: findings.length }), 9, INK);
  para(tr("fx.moneyNote", { code: r.currency ?? "USD" }), 8, MUTED);
  y -= 6;
  heading(tr("report.executiveSummary"));
  // Four headline numbers.
  const gap = 10, boxW = (W - gap * 3) / 4, boxH = 80, top = y + 8;
  const kpis: { label: string; value: string; hint: string; tone: Color }[] = [
    { label: tr("report.kpi.leak"), value: $(headline), hint: tr("report.kpi.leakHint", { count: findings.length }), tone: LOSS },
    { label: tr("report.kpi.share"), value: pct(share(headline, pocket)), hint: tr("report.kpi.shareHint", { pocket: $(pocket) }), tone: LOSS },
    { label: tr("report.kpi.margin"), value: percent(locale, w.rate), hint: tr("report.kpi.marginHint", { margin: $(w.margin) }), tone: INK },
    { label: tr("report.kpi.lines"), value: n(scope?.affectedLines ?? "0"), hint: tr("report.kpi.linesHint", { count: Number(w.lines) }), tone: INK },
  ];
  kpis.forEach((k, i) => {
    const x = L + i * (boxW + gap);
    pdf.rect(x, top - boxH, boxW, boxH, PANEL); pdf.rect(x, top - 3, boxW, 3, k.tone === LOSS ? LOSS : ACCENT);
    const label = Pdf.wrap(k.label, 7.5, boxW - 18).slice(0, 2), hint = Pdf.wrap(k.hint, 7, boxW - 18).slice(0, 2);
    label.forEach((line, j) => pdf.text(x + 9, top - 16 - j * 9, line, 7.5, true, MUTED));
    const z = sizeFor(k.value, 16, boxW - 18); pdf.text(x + 9, top - 46, k.value, z, true, k.tone);
    hint.forEach((line, j) => pdf.text(x + 9, top - 60 - j * 8.5, line, 7, false, MUTED));
  });
  y = top - boxH - 18;
  // What the numbers say, in sentences.
  if (!findings.length) para(tr("report.summaryNone"), 10);
  else {
    const first = findings[0], topN = findings.slice(0, Math.min(3, findings.length)), topSum = topN.reduce((a, f) => a + BigInt(f.cents), BigInt(0));
    para(tr("report.summary", { amount: $(headline), share: pct(share(headline, pocket)) }), 10);
    if (findings.length > 1) para(tr("report.summaryTop", { title: text(first.title), amount: $(first.cents), share: pct(share(BigInt(first.cents), sumOf)) }), 10);
    if (findings.length > 1) para(tr("report.summaryTopN", { count: topN.length, share: pct(share(topSum, sumOf)) }), 10);
    if (leaks.overlapLines !== "0") { y -= 2; para(tr("report.overlapNote", { count: Number(leaks.overlapLines), overlapCents: $(leaks.overlapCents), totalCents: $(leaks.totalCents) }), 8, MUTED); }
  }
  // What needs attention first: the largest findings, each with a recommended action.
  if (findings.length) {
    y -= 4; heading(tr("report.attention")); para(tr("report.attentionHelp"), 8, MUTED); y -= 4;
    findings.slice(0, 5).forEach((f, i) => {
      const p = priorityOf(BigInt(f.cents), sumOf), amount = $(f.cents), titleMax = R - L - 30 - Pdf.widthOf(amount, 10) - 70;
      const titleLines = Pdf.wrap(text(f.title), 10, titleMax), action = Pdf.wrap(tr(actionKey(f)), 8, W - 30);
      need(30 + titleLines.length * 13 + action.length * 11);
      pdf.text(L, y, n(i + 1), 10, true, ACCENT);
      const pw = pill(L + 18, y, p);
      titleLines.forEach((line, k) => pdf.text(L + 24 + pw, y - k * 13, line, 10, true, INK));
      pdf.text(R, y, amount, 10, true, LOSS, "right");
      y -= titleLines.length * 13;
      pdf.text(L + 18, y, Pdf.fit(tr("report.attentionMeta", { label: text(f.label), count: Number(f.lines), share: pct(share(BigInt(f.cents), sumOf)) }), 8, W - 18), 8, false, MUTED); y -= 12;
      pdf.text(L + 18, y, tr("report.recommended"), 8, true, ACCENT); y -= 11;
      for (const line of action) { pdf.text(L + 18, y, line, 8, false, INK); y -= 11; }
      y -= 5; pdf.line(L, y + 4, R, y + 4, RULE); y -= 8;
    });
    if (findings.length > 5) para(tr("report.moreFindings", { count: findings.length - 5 }), 8, MUTED);
    // Where the margin leaks, by type.
    const byType = new Map<string, bigint>();
    for (const f of findings) byType.set(text(f.label), (byType.get(text(f.label)) ?? BigInt(0)) + BigInt(f.cents));
    const types = [...byType.entries()].sort((a, b) => b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0), biggest = types[0]?.[1] ?? BigInt(1);
    y -= 4; heading(tr("report.byType"), 110); para(tr("report.byTypeHelp"), 8, MUTED); y -= 2;
    for (const [label, cents] of types) {
      need(20);
      pdf.text(L, y, Pdf.fit(label, 9, 170), 9, false, INK);
      const len = biggest > BigInt(0) ? Number(cents * BigInt(1000) / biggest) / 1000 * 210 : 0; // drawing size only; amounts stay exact
      pdf.rect(L + 180, y - 2, 210, 10, PANEL); pdf.rect(L + 180, y - 2, Math.max(1, len), 10, LOSS_BAR);
      pdf.text(R - 52, y, $(cents), 9, true, INK, "right"); pdf.text(R, y, pct(share(cents, sumOf)), 9, false, MUTED, "right");
      y -= 17;
    }
  }

  // ---------------------------------------------------------------- Waterfall
  y -= 8; heading(tr("report.marginWaterfallListPrice"), 120); para(tr("report.waterfallHelp"), 8, MUTED); y -= 4;
  const scale = Math.max(1, Math.abs(Number(w.sales.list)));
  w.steps.forEach((s, i) => {
    need(18);
    const v = Number(s.cents), len = Math.min(1, Math.abs(v) / scale) * 160, strong = s.kind === "subtotal" || s.kind === "end" || s.kind === "start";
    if (i % 2 === 0) pdf.rect(L, y - 5, W, 17, PANEL);
    pdf.text(L + 6, y, Pdf.fit(text(s.label), 9, 220), 9, strong, s.kind === "excluded" ? MUTED : INK);
    pdf.rect(L + 236, y - 2, Math.max(0.5, len), 9, s.kind === "minus" || v < 0 ? LOSS_BAR : BAR); // bar length is a drawing size only; the amount stays exact
    pdf.text(R - 6, y, $(s.cents), 9, strong, v < 0 ? LOSS : INK, "right");
    y -= 17;
  });
  y -= 4;
  para(tr("report.pocketMarginRateOf", { rate: percent(locale, w.rate), count: Number(w.uncostedLines) }), 8, MUTED);
  para(tr("report.returnsAndCreditsCredit", { count: Number(w.credits.lines), pocket: $(w.credits.pocket) }), 8, MUTED);
  y -= 8;

  // ---------------------------------------------------------------- Every finding in scope
  heading(tr("report.allFindings"), 110);
  const col = { n: L + 4, pr: L + 20, type: L + 72, find: L + 182, lines: R - 128, leak: R - 46, share: R - 4 }, findMax = col.lines - 44 - col.find;
  const head = () => { pdf.rect(L, y - 5, W, 16, NAVY); const hy = y; pdf.text(col.n, hy, "#", 7.5, true, WHITE); pdf.text(col.pr, hy, tr("report.priority"), 7.5, true, WHITE); pdf.text(col.type, hy, tr("report.type"), 7.5, true, WHITE); pdf.text(col.find, hy, tr("report.finding"), 7.5, true, WHITE);
    pdf.text(col.lines, hy, tr("report.lines"), 7.5, true, WHITE, "right"); pdf.text(col.leak, hy, tr("report.leak2"), 7.5, true, WHITE, "right"); pdf.text(col.share, hy, tr("report.share"), 7.5, true, WHITE, "right"); y -= 18; };
  if (!findings.length) para(tr("report.noLeaksFoundBy"), 9, MUTED);
  else {
    need(40); head();
    findings.forEach((f, i) => {
      const titleLines = Pdf.wrap(text(f.title), 8, findMax).slice(0, 3), typeLines = Pdf.wrap(text(f.label), 8, col.find - col.type - 8).slice(0, 2), rows = Math.max(titleLines.length, typeLines.length), h = rows * 10 + 7;
      if (y - h < BOTTOM) { newPage(); head(); }
      if (i % 2 === 1) pdf.rect(L, y - h + 7, W, h, PANEL);
      pdf.text(col.n, y, n(i + 1), 8); pill(col.pr, y, priorityOf(BigInt(f.cents), sumOf));
      typeLines.forEach((t, k) => pdf.text(col.type, y - k * 10, t, 8, false, INK));
      titleLines.forEach((t, k) => pdf.text(col.find, y - k * 10, t, 8, false, INK));
      pdf.text(col.lines, y, n(f.lines), 8, false, INK, "right"); pdf.text(col.leak, y, $(f.cents), 8, true, LOSS, "right"); pdf.text(col.share, y, pct(share(BigInt(f.cents), sumOf)), 8, false, MUTED, "right");
      y -= h;
    });
    y -= 4; pdf.line(L, y + 6, R, y + 6, RULE);
    pdf.text(col.find, y - 4, tr("report.sumOfFindings"), 8, true, INK); pdf.text(col.leak, y - 4, $(sumOf), 8, true, INK, "right"); y -= 14;
    if (leaks.overlapLines !== "0") { pdf.text(col.find, y - 4, tr("report.lessOverlap"), 8, false, MUTED); pdf.text(col.leak, y - 4, $(-BigInt(leaks.overlapCents)), 8, false, MUTED, "right"); y -= 14; }
    pdf.text(col.find, y - 4, tr("report.kpi.leak"), 8, true, LOSS); pdf.text(col.leak, y - 4, $(headline), 8, true, LOSS, "right"); y -= 20;
  }

  // ---------------------------------------------------------------- Evidence for the largest findings
  if (findings.length) {
    heading(tr("report.evidence"), 170); para(tr("report.evidenceHelp"), 8, MUTED); y -= 4;
    for (const f of findings.slice(0, 6)) {
      const rows = (r.evidence[f.id] ?? []).slice(0, 5), formula = Pdf.wrap(text(f.formula), 8, W - 16), detail = Pdf.wrap(text(f.detail), 8, W - 16);
      need(46 + (formula.length + detail.length) * 10 + rows.length * 11);
      pdf.rect(L, y - 6, W, 18, PANEL); pdf.rect(L, y - 6, 3, 18, ACCENT);
      pdf.text(L + 10, y, Pdf.fit(tr("report.findingHeading", { label: text(f.label), title: text(f.title) }), 9.5, W - 120), 9.5, true, INK); pdf.text(R - 8, y, $(f.cents), 9.5, true, LOSS, "right"); y -= 22;
      pdf.text(L + 8, y, tr("report.formulaLabel"), 8, true, ACCENT); y -= 10;
      for (const line of formula) { pdf.text(L + 8, y, line, 8, false, INK); y -= 10; }
      for (const line of detail) { pdf.text(L + 8, y, line, 8, false, MUTED); y -= 10; }
      y -= 3;
      const ex = { src: L + 8, inv: L + 200, prod: L + 270, cust: L + 344, list: L + 450, leak: R - 8 };
      pdf.text(ex.src, y, tr("report.sourceFileRow"), 7, true, MUTED); pdf.text(ex.inv, y, tr("report.invoice"), 7, true, MUTED); pdf.text(ex.prod, y, tr("report.product"), 7, true, MUTED); pdf.text(ex.cust, y, tr("report.customer"), 7, true, MUTED);
      pdf.text(ex.list, y, tr("report.list"), 7, true, MUTED, "right"); pdf.text(ex.leak, y, tr("report.leak"), 7, true, MUTED, "right"); y -= 4; pdf.line(L + 8, y, R - 8, y, RULE); y -= 9;
      for (const e of rows) {
        pdf.text(ex.src, y, Pdf.fit(tr("report.row", { sourceFile: e.sourceFile, sourceRow: Number(e.sourceRow) }), 7, 186), 7); pdf.text(ex.inv, y, Pdf.fit(e.invoice, 7, 66), 7); pdf.text(ex.prod, y, Pdf.fit(e.product, 7, 70), 7); pdf.text(ex.cust, y, Pdf.fit(e.customer, 7, 60), 7);
        pdf.text(ex.list, y, $(e.list), 7, false, INK, "right"); pdf.text(ex.leak, y, $(e.leak), 7, true, LOSS, "right"); y -= 11;
      }
      if (Number(f.lines) > rows.length) { pdf.text(ex.src, y, tr("report.moreLines", { count: Number(f.lines) - rows.length }), 7, false, MUTED); y -= 10; }
      y -= 12;
    }
    if (findings.length > 6) { para(tr("report.evidenceMore", { count: findings.length - 6 }), 8, MUTED); y -= 6; }
  }

  // ---------------------------------------------------------------- Method
  heading(tr("report.howTheseNumbersAre"));
  for (const t of [
    tr("report.moneyIsExactInteger"),
    tr("report.aTierSPeer", { minimum: $(String(RULES.modeMinListCents)) }),
    tr("report.overDiscountedAtLeast", { value: RULES.excessBp / 100, value2: RULES.patternShare * 100 }),
    tr("report.unrecoveredFreightFreightAbove", { value: RULES.freightShareBp / 100, count: Number(leaks.checked.uncostedLines) }),
    tr("report.returnsAndCreditsLines", { count: Number(leaks.checked.creditLines) }),
    tr("report.priorityRule"),
    r.sample ? tr("report.sampleFindingsAreNot") : tr("report.roiTrackerFoundAcross", { identifiedCents: $(r.roi.identifiedCents), count: Number(r.roi.findings) }),
  ]) { para(t, 8, MUTED); y -= 3; }
  y -= 4; para(tr("report.theseAreFindingsTo"), 8.5, INK, true);

  // Footer with page numbers on every page.
  pdf.eachPage((i, count) => {
    pdf.line(L, 44, R, 44, RULE);
    pdf.text(L, 30, Pdf.fit(tr("report.rebatehqMarginLeakReport2"), 7, W - 80), 7, false, MUTED);
    pdf.text(R, 30, tr("report.page", { page: n(i + 1), pages: n(count) }), 7, false, MUTED, "right");
  });
  return pdf.bytes(tr("report.rebatehqMarginLeakReport"));
}
