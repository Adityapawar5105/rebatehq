// A minimal PDF 1.4 writer (text, rectangles, lines) with the standard Helvetica fonts.
// Runs in the vault worker; nothing is uploaded. Streams are uncompressed ASCII, so
// tests can read the text back. Non-ASCII characters are replaced with "?".
export type Color = [number, number, number];
export class Pdf {
  private pages: string[][] = [];
  readonly width = 612; readonly height = 792;
  page() { this.pages.push([]); return this; }
  private get ops() { if (!this.pages.length) this.page(); return this.pages[this.pages.length - 1]; }
  get pageCount() { return this.pages.length; }
  static ascii(s: string) { return s.replace(/[‒-―]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/×/g, "x").replace(/[^\x20-\x7e]/g, "?"); }
  static esc(s: string) { return Pdf.ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
  /** Approximate Helvetica width (points) for layout; good enough for truncation. */
  static widthOf(s: string, size: number) { let w = 0; for (const ch of s) w += /[il.,:;'|!]/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.86 : /[A-Z0-9$%]/.test(ch) ? 0.64 : 0.52; return w * size; }
  static fit(s: string, size: number, max: number) { if (Pdf.widthOf(s, size) <= max) return s; let t = s; while (t.length > 1 && Pdf.widthOf(t + "...", size) > max) t = t.slice(0, -1); return t + "..."; }
  text(x: number, y: number, s: string, size = 10, bold = false, color: Color = [0.1, 0.1, 0.12], align: "left" | "right" = "left") {
    const at = align === "right" ? x - Pdf.widthOf(s, size) : x;
    this.ops.push(`BT ${color.map(c => c.toFixed(3)).join(" ")} rg /${bold ? "F2" : "F1"} ${size} Tf ${at.toFixed(2)} ${y.toFixed(2)} Td (${Pdf.esc(s)}) Tj ET`);
    return this;
  }
  rect(x: number, y: number, w: number, h: number, color: Color) { this.ops.push(`${color.map(c => c.toFixed(3)).join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); return this; }
  line(x1: number, y1: number, x2: number, y2: number, color: Color = [0.8, 0.8, 0.82], width = 0.5) { this.ops.push(`${color.map(c => c.toFixed(3)).join(" ")} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`); return this; }
  bytes(title: string): Uint8Array {
    if (!this.pages.length) this.page();
    const objects: string[] = [], n = this.pages.length;
    // 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (page, content) pairs
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Count ${n} /Kids [${this.pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ")}] >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[5] = `<< /Title (${Pdf.esc(title)}) /Producer (MarginDesk local report) >>`;
    this.pages.forEach((ops, i) => {
      const content = ops.join("\n");
      objects[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + i * 2} 0 R >>`;
      objects[7 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });
    let out = "%PDF-1.4\n"; const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out); // ASCII only, so string offsets equal byte offsets
  }
}
