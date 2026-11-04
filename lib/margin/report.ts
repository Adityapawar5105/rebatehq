// Margin Leak Report: a client-side PDF built in the vault worker from the leak finder,
// the waterfall and the ROI ledger. It is handed to the page as a Blob; nothing is uploaded.
import { Pdf, type Color } from "./pdf";
import { moneyText } from "../spike/exact";
import type { LeakResult, LeakRow } from "./leaks";
import { RULES } from "./leaks";
import type { Waterfall } from "./views";
import type { RoiSummary } from "./roi";
export type ReportInput = { generatedAt: string; sample: boolean; lines: string; from: string | null; to: string | null; sources: string[]; waterfall: Waterfall; leaks: LeakResult; roi: RoiSummary; evidence: Record<string, LeakRow[]> };
const INK: Color = [0.1, 0.1, 0.12], MUTED: Color = [0.42, 0.42, 0.46], ACCENT: Color = [0.11, 0.37, 0.62], LOSS: Color = [0.7, 0.16, 0.12], BAR: Color = [0.78, 0.85, 0.93], PANEL: Color = [0.95, 0.96, 0.97];
const $ = (cents: string) => "$" + moneyText(cents);
export function leakReport(r: ReportInput): Uint8Array {
  const pdf = new Pdf(), L = 48, R = pdf.width - 48;
  let y = 0;
  const newPage = () => { pdf.page(); y = pdf.height - 56; pdf.text(L, 28, "RebateHQ - Margin Leak Report - generated on this device; nothing was uploaded", 7, false, MUTED); };
  const need = (h: number) => { if (y - h < 48) newPage(); };
  newPage();
  pdf.text(L, y, "Margin Leak Report", 22, true, INK); y -= 18;
  pdf.text(L, y, `Generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC in the browser from the local vault. ${r.sample ? "SAMPLE DATA: the fictional Playground distributor." : ""}`, 9, false, r.sample ? LOSS : MUTED); y -= 13;
  pdf.text(L, y, Pdf.fit(`${Number(r.lines).toLocaleString("en-US")} invoice lines${r.from ? `, ${r.from} to ${r.to}` : ""}. Sources: ${r.sources.join(", ")}`, 9, R - L), 9, false, MUTED); y -= 26;
  // Headline
  pdf.rect(L, y - 58, R - L, 66, PANEL);
  pdf.text(L + 14, y - 12, "Leak dollars found", 10, false, MUTED);
  pdf.text(L + 14, y - 38, $(r.leaks.dedupedCents), 24, true, LOSS);
  pdf.text(L + 250, y - 12, `${r.leaks.findings.length} findings; sum of findings ${$(r.leaks.totalCents)}`, 9, false, INK);
  pdf.text(L + 250, y - 26, `${Number(r.leaks.overlapLines).toLocaleString("en-US")} lines sit in more than one finding; their overlap of`, 9, false, INK);
  pdf.text(L + 250, y - 40, `${$(r.leaks.overlapCents)} is counted once in the headline.`, 9, false, INK);
  pdf.text(L + 250, y - 54, r.sample ? "Sample findings are not added to your ROI tracker." : `ROI tracker: ${$(r.roi.identifiedCents)} found across ${r.roi.findings} findings so far.`, 9, false, MUTED);
  y -= 84;
  // Waterfall
  pdf.text(L, y, "Margin waterfall: list price to pocket margin", 13, true, INK); y -= 18;
  const w = r.waterfall, scale = Math.max(1, Math.abs(Number(w.sales.list)));
  for (const s of w.steps) {
    need(16);
    const v = Number(s.cents), len = Math.min(1, Math.abs(v) / scale) * 200;
    pdf.text(L, y, s.label, 9, s.kind === "subtotal" || s.kind === "end", s.kind === "excluded" ? MUTED : INK);
    pdf.rect(L + 250, y - 2, Math.max(0.5, len), 9, s.kind === "minus" || v < 0 ? [0.94, 0.8, 0.78] : BAR);
    const c = BigInt(s.cents); // bar length is a drawing size only; the amount stays exact
    pdf.text(R, y, (c < BigInt(0) ? "-" : "") + $(String(c < BigInt(0) ? -c : c)), 9, s.kind === "end", v < 0 ? LOSS : INK, "right");
    y -= 15;
  }
  pdf.text(L, y, `Pocket margin rate ${w.rate} of pocket with known cost. ${Number(w.uncostedLines).toLocaleString("en-US")} lines have unknown cost; their pocket is left out of margin (cost is never assumed to be zero).`, 8, false, MUTED); y -= 12;
  pdf.text(L, y, `Returns and credits: ${Number(w.credits.lines).toLocaleString("en-US")} credit lines net ${$(w.credits.pocket)} against sales.`, 8, false, MUTED); y -= 24;
  // Findings table
  need(60);
  pdf.text(L, y, "Findings", 13, true, INK); y -= 16;
  const head = () => { pdf.text(L, y, "#", 8, true, MUTED); pdf.text(L + 18, y, "Type", 8, true, MUTED); pdf.text(L + 150, y, "Finding", 8, true, MUTED); pdf.text(R - 70, y, "Lines", 8, true, MUTED, "right"); pdf.text(R, y, "Leak", 8, true, MUTED, "right"); y -= 4; pdf.line(L, y, R, y); y -= 11; };
  head();
  r.leaks.findings.forEach((f, i) => {
    if (y < 60) { newPage(); head(); }
    pdf.text(L, y, String(i + 1), 8); pdf.text(L + 18, y, Pdf.fit(f.label, 8, 128), 8);
    pdf.text(L + 150, y, Pdf.fit(f.title, 8, R - 70 - 40 - (L + 150)), 8); pdf.text(R - 70, y, Number(f.lines).toLocaleString("en-US"), 8, false, INK, "right"); pdf.text(R, y, $(f.cents), 8, true, LOSS, "right");
    y -= 13;
  });
  if (!r.leaks.findings.length) { pdf.text(L, y, "No leaks found by the current rules.", 9, false, MUTED); y -= 13; }
  y -= 10;
  // Evidence for the largest findings
  for (const f of r.leaks.findings.slice(0, 6)) {
    const rows = r.evidence[f.id] ?? [];
    need(40 + Math.min(5, rows.length) * 12);
    pdf.text(L, y, Pdf.fit(`${f.label}: ${f.title}`, 10, R - L), 10, true, ACCENT); y -= 13;
    pdf.text(L, y, Pdf.fit(f.formula, 8, R - L), 8, false, INK); y -= 11;
    pdf.text(L, y, Pdf.fit(f.detail, 8, R - L), 8, false, MUTED); y -= 13;
    pdf.text(L, y, "Source file, row", 7, true, MUTED); pdf.text(L + 200, y, "Invoice", 7, true, MUTED); pdf.text(L + 270, y, "Product", 7, true, MUTED); pdf.text(L + 340, y, "Customer", 7, true, MUTED); pdf.text(L + 410, y, "List", 7, true, MUTED, "right"); pdf.text(R, y, "Leak", 7, true, MUTED, "right"); y -= 10;
    for (const e of rows.slice(0, 5)) {
      pdf.text(L, y, Pdf.fit(`${e.sourceFile}, row ${e.sourceRow}`, 7, 195), 7); pdf.text(L + 200, y, Pdf.fit(e.invoice, 7, 66), 7); pdf.text(L + 270, y, Pdf.fit(e.product, 7, 66), 7); pdf.text(L + 340, y, Pdf.fit(e.customer, 7, 40), 7);
      pdf.text(L + 410, y, $(e.list), 7, false, INK, "right"); pdf.text(R, y, $(e.leak), 7, true, LOSS, "right"); y -= 10;
    }
    if (Number(f.lines) > rows.slice(0, 5).length) { pdf.text(L, y, `... and ${(Number(f.lines) - Math.min(5, rows.length)).toLocaleString("en-US")} more lines; every line is listed under "Show the math" in RebateHQ.`, 7, false, MUTED); y -= 10; }
    y -= 10;
  }
  // Method
  need(110);
  pdf.text(L, y, "How these numbers are found", 11, true, INK); y -= 14;
  for (const t of [
    `Money is exact integer cents. Pocket = list - discount - rebate - freight; pocket margin = pocket - cost, on lines with a known cost only.`,
    `A tier's peer rate is the most common discount rate among that tier's lines of $100 or more. Until price guardrails are set, it is the tier floor.`,
    `Over-discounted: at least ${RULES.excessBp / 100} point above the peer rate. Patterns need ${RULES.patternShare * 100}% of a customer's (or customer x category's) lines.`,
    `Unrecovered freight: freight above ${RULES.freightShareBp / 100}% of the line's list. Margin rules skip lines with unknown cost (${Number(r.leaks.checked.uncostedLines).toLocaleString("en-US")} lines).`,
    `Returns and credits (${Number(r.leaks.checked.creditLines).toLocaleString("en-US")} lines) are netted in the waterfall and are never counted as leaks.`,
    `These are findings to review with your pricing owner, not verified recoveries. Recovered dollars are tracked from Phase 2.`,
  ]) { need(12); pdf.text(L, y, Pdf.fit(t, 8, R - L), 8, false, MUTED); y -= 12; }
  return pdf.bytes("RebateHQ Margin Leak Report");
}
