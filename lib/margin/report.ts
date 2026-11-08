// Margin Leak Report: a client-side PDF built in the vault worker from the leak finder,
// the waterfall and the ROI ledger. It is handed to the page as a Blob; nothing is uploaded.
// Chunk 7U: every sentence comes from a message key and every number, amount and date is
// formatted with Intl in the user's language (the finder's own text is a message reference).
import { Pdf, type Color } from "./pdf";
import type { LeakResult, LeakRow } from "./leaks";
import { RULES } from "./leaks";
import type { Waterfall } from "./views";
import type { RoiSummary } from "./roi";
import { currency, dateTime, date, integer, percent, say, translate, type Locale, type MessageKey, type Params } from "../i18n/core";
export type ReportInput = { currency?: string; locale?: Locale; generatedAt: string; sample: boolean; lines: string; from: string | null; to: string | null; sources: string[]; waterfall: Waterfall; leaks: LeakResult; roi: RoiSummary; evidence: Record<string, LeakRow[]> };
const INK: Color = [0.1, 0.1, 0.12], MUTED: Color = [0.42, 0.42, 0.46], ACCENT: Color = [0.11, 0.37, 0.62], LOSS: Color = [0.7, 0.16, 0.12], BAR: Color = [0.78, 0.85, 0.93], PANEL: Color = [0.95, 0.96, 0.97];
export function leakReport(r: ReportInput): Uint8Array {
  const locale: Locale = r.locale ?? "en";
  const tr = (key: MessageKey, params?: Params) => translate(locale, key, params), $ = (cents: string) => currency(locale, cents, r.currency ?? "USD"), n = (v: string | number) => integer(locale, v), text = (s: string) => say(locale, s);
  const pdf = new Pdf(), L = 48, R = pdf.width - 48;
  let y = 0;
  const newPage = () => { pdf.page(); y = pdf.height - 56; pdf.text(L, 28, tr("report.rebatehqMarginLeakReport2"), 7, false, MUTED); };
  const need = (h: number) => { if (y - h < 48) newPage(); };
  newPage();
  pdf.text(L, y, tr("report.marginLeakReport"), 22, true, INK); y -= 18;
  pdf.text(L, y, tr(r.sample ? "report.generatedSample" : "report.generated", { when: dateTime(locale, r.generatedAt, true) }), 9, false, r.sample ? LOSS : MUTED); y -= 13;
  pdf.text(L, y, Pdf.fit(tr(r.from ? "report.linesRangeSources" : "report.linesSources", { count: Number(r.lines), from: date(locale, r.from), to: date(locale, r.to), sources: r.sources.join(", ") }), 9, R - L), 9, false, MUTED); y -= 13;
  pdf.text(L,y,tr("fx.moneyNote",{code:r.currency ?? "USD"}),9,false,MUTED); y -= 13;
  // Headline
  pdf.rect(L, y - 58, R - L, 66, PANEL);
  pdf.text(L + 14, y - 12, tr("report.leakDollarsFound"), 10, false, MUTED);
  pdf.text(L + 14, y - 38, $(r.leaks.dedupedCents), 24, true, LOSS);
  pdf.text(L + 250, y - 12, tr("report.findingsSumOfFindings", { count: r.leaks.findings.length, totalCents: $(r.leaks.totalCents) }), 9, false, INK);
  pdf.text(L + 250, y - 26, tr("report.linesSitInMore", { count: Number(r.leaks.overlapLines) }), 9, false, INK);
  pdf.text(L + 250, y - 40, tr("report.isCountedOnceIn", { overlapCents: $(r.leaks.overlapCents) }), 9, false, INK);
  pdf.text(L + 250, y - 54, r.sample ? tr("report.sampleFindingsAreNot") : tr("report.roiTrackerFoundAcross", { identifiedCents: $(r.roi.identifiedCents), count: Number(r.roi.findings) }), 9, false, MUTED);
  y -= 84;
  // Waterfall
  pdf.text(L, y, tr("report.marginWaterfallListPrice"), 13, true, INK); y -= 18;
  const w = r.waterfall, scale = Math.max(1, Math.abs(Number(w.sales.list)));
  for (const s of w.steps) {
    need(16);
    const v = Number(s.cents), len = Math.min(1, Math.abs(v) / scale) * 200;
    pdf.text(L, y, text(s.label), 9, s.kind === "subtotal" || s.kind === "end", s.kind === "excluded" ? MUTED : INK);
    pdf.rect(L + 250, y - 2, Math.max(0.5, len), 9, s.kind === "minus" || v < 0 ? [0.94, 0.8, 0.78] : BAR);
    pdf.text(R, y, $(s.cents), 9, s.kind === "end", v < 0 ? LOSS : INK, "right"); // bar length is a drawing size only; the amount stays exact
    y -= 15;
  }
  pdf.text(L, y, tr("report.pocketMarginRateOf", { rate: percent(locale, w.rate), count: Number(w.uncostedLines) }), 8, false, MUTED); y -= 12;
  pdf.text(L, y, tr("report.returnsAndCreditsCredit", { count: Number(w.credits.lines), pocket: $(w.credits.pocket) }), 8, false, MUTED); y -= 24;
  // Findings table
  need(60);
  pdf.text(L, y, tr("report.findings"), 13, true, INK); y -= 16;
  const head = () => { pdf.text(L, y, "#", 8, true, MUTED); pdf.text(L + 18, y, tr("report.type"), 8, true, MUTED); pdf.text(L + 150, y, tr("report.finding"), 8, true, MUTED); pdf.text(R - 70, y, tr("report.lines"), 8, true, MUTED, "right"); pdf.text(R, y, tr("report.leak2"), 8, true, MUTED, "right"); y -= 4; pdf.line(L, y, R, y); y -= 11; };
  head();
  r.leaks.findings.forEach((f, i) => {
    if (y < 60) { newPage(); head(); }
    pdf.text(L, y, n(i + 1), 8); pdf.text(L + 18, y, Pdf.fit(text(f.label), 8, 128), 8);
    pdf.text(L + 150, y, Pdf.fit(text(f.title), 8, R - 70 - 40 - (L + 150)), 8); pdf.text(R - 70, y, n(f.lines), 8, false, INK, "right"); pdf.text(R, y, $(f.cents), 8, true, LOSS, "right");
    y -= 13;
  });
  if (!r.leaks.findings.length) { pdf.text(L, y, tr("report.noLeaksFoundBy"), 9, false, MUTED); y -= 13; }
  y -= 10;
  // Evidence for the largest findings
  for (const f of r.leaks.findings.slice(0, 6)) {
    const rows = r.evidence[f.id] ?? [];
    need(40 + Math.min(5, rows.length) * 12);
    pdf.text(L, y, Pdf.fit(tr("report.findingHeading", { label: text(f.label), title: text(f.title) }), 10, R - L), 10, true, ACCENT); y -= 13;
    pdf.text(L, y, Pdf.fit(text(f.formula), 8, R - L), 8, false, INK); y -= 11;
    pdf.text(L, y, Pdf.fit(text(f.detail), 8, R - L), 8, false, MUTED); y -= 13;
    pdf.text(L, y, tr("report.sourceFileRow"), 7, true, MUTED); pdf.text(L + 200, y, tr("report.invoice"), 7, true, MUTED); pdf.text(L + 270, y, tr("report.product"), 7, true, MUTED); pdf.text(L + 340, y, tr("report.customer"), 7, true, MUTED); pdf.text(L + 410, y, tr("report.list"), 7, true, MUTED, "right"); pdf.text(R, y, tr("report.leak"), 7, true, MUTED, "right"); y -= 10;
    for (const e of rows.slice(0, 5)) {
      pdf.text(L, y, Pdf.fit(tr("report.row", { sourceFile: e.sourceFile, sourceRow: Number(e.sourceRow) }), 7, 195), 7); pdf.text(L + 200, y, Pdf.fit(e.invoice, 7, 66), 7); pdf.text(L + 270, y, Pdf.fit(e.product, 7, 66), 7); pdf.text(L + 340, y, Pdf.fit(e.customer, 7, 40), 7);
      pdf.text(L + 410, y, $(e.list), 7, false, INK, "right"); pdf.text(R, y, $(e.leak), 7, true, LOSS, "right"); y -= 10;
    }
    if (Number(f.lines) > rows.slice(0, 5).length) { pdf.text(L, y, tr("report.moreLines", { count: Number(f.lines) - Math.min(5, rows.length) }), 7, false, MUTED); y -= 10; }
    y -= 10;
  }
  // Method
  need(110);
  pdf.text(L, y, tr("report.howTheseNumbersAre"), 11, true, INK); y -= 14;
  for (const t of [
    tr("report.moneyIsExactInteger"),
    tr("report.aTierSPeer",{minimum:$(String(RULES.modeMinListCents))}),
    tr("report.overDiscountedAtLeast", { value: RULES.excessBp / 100, value2: RULES.patternShare * 100 }),
    tr("report.unrecoveredFreightFreightAbove", { value: RULES.freightShareBp / 100, count: Number(r.leaks.checked.uncostedLines) }),
    tr("report.returnsAndCreditsLines", { count: Number(r.leaks.checked.creditLines) }),
    tr("report.theseAreFindingsTo"),
  ]) { need(12); pdf.text(L, y, Pdf.fit(t, 8, R - L), 8, false, MUTED); y -= 12; }
  return pdf.bytes(tr("report.rebatehqMarginLeakReport"));
}
