// A minimal PDF 1.4 writer (text, rectangles, lines, JPEG images) with the standard Helvetica fonts.
// Runs in the vault worker; nothing is uploaded. Streams are uncompressed ASCII, so
// tests can read the text back. Non-ASCII characters are replaced with "?". A JPEG is
// written hex-encoded (ASCIIHexDecode then DCTDecode), so the file stays ASCII too.
export type Color = [number, number, number];
export type JpegInfo = { width: number; height: number; colors: 1 | 3 };
export class Pdf {
  private pages: string[][] = [];
  private images: { data: Uint8Array; info: JpegInfo }[] = [];
  /** Width, height and colour channels of a baseline or progressive JPEG; null for anything else (CMYK included). */
  static jpegInfo(b: Uint8Array): JpegInfo | null {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (b[i + 5] << 8) | b[i + 6], width = (b[i + 7] << 8) | b[i + 8], colors = b[i + 9];
        return width > 0 && height > 0 && (colors === 1 || colors === 3) ? { width, height, colors } : null;
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }
  /** Draws a JPEG with its lower-left corner at (x, y), scaled to w by h points. */
  image(x: number, y: number, w: number, h: number, jpeg: Uint8Array) {
    const info = Pdf.jpegInfo(jpeg); if (!info) throw new Error("Not a supported JPEG");
    const n = this.images.push({ data: jpeg, info }) - 1;
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${n} Do Q`);
    return this;
  }
  readonly width = 612; readonly height = 792;
  page() { this.pages.push([]); return this; }
  private cursor: number | null = null;
  private get ops() { if (!this.pages.length) this.page(); return this.pages[this.cursor ?? this.pages.length - 1]; }
  get pageCount() { return this.pages.length; }
  /** Draws on every page after the layout is done (page numbers, footers), then returns to the last page. */
  eachPage(draw: (index: number, count: number) => void) { const n = this.pages.length; try { for (let i = 0; i < n; i++) { this.cursor = i; draw(i, n); } } finally { this.cursor = null; } return this; }
  /** Word-wraps text into lines no wider than `max` points; a single over-long word is truncated. */
  static wrap(s: string, size: number, max: number): string[] {
    const out: string[] = []; let line = "";
    for (const word of s.split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (Pdf.widthOf(next, size) <= max) { line = next; continue; }
      if (line) out.push(line);
      line = Pdf.widthOf(word, size) <= max ? word : Pdf.fit(word, size, max);
    }
    if (line) out.push(line);
    return out.length ? out : [""];
  }
  static ascii(s: string) { return s.replace(/[‒-―]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/×/g, "x").replace(/[^\x20-\x7e]/g, "?"); }
  /**
   * PDF string escape in WinAnsiEncoding (chunk 7U): accented Latin letters used by Spanish and
   * French (é, ñ, ç, à, œ, «, €…) are written as octal escapes, so the stream stays ASCII.
   * Spaces Intl uses in French numbers become ordinary spaces; anything else outside WinAnsi is "?".
   */
  static esc(s: string) {
    let out = "";
    for (const ch of s) {
      if (ch === "\\" || ch === "(" || ch === ")") { out += "\\" + ch; continue; }
      const code = Pdf.winAnsi(ch);
      out += code === null ? "?" : code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : "\\" + code.toString(8).padStart(3, "0");
    }
    return out;
  }
  private static readonly CP1252: Record<string, number> = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
  static winAnsi(ch: string): number | null {
    const p = ch.codePointAt(0)!;
    if (p >= 0x20 && p < 0x7f) return p;
    if (p === 0x202f || p === 0x2009 || p === 0x2007 || p === 0x00a0) return 0x20;
    if (p === 0x2212 || p === 0x2012 || p === 0x2011) return 0x2d;
    if (p >= 0xa1 && p <= 0xff) return p;
    return Pdf.CP1252[ch] ?? null;
  }
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
    objects[5] = `<< /Title (${Pdf.esc(title)}) /Producer (RebateHQ local report) >>`;
    const first = 6 + n * 2, hex = (d: Uint8Array) => { let s = ""; for (let i = 0; i < d.length; i++) { s += d[i].toString(16).padStart(2, "0"); if (i % 64 === 63) s += "\n"; } return s + ">"; };
    const xobjects = this.images.length ? ` /XObject << ${this.images.map((_, k) => `/Im${k} ${first + k} 0 R`).join(" ")} >>` : "";
    this.pages.forEach((ops, i) => {
      const content = ops.join("\n");
      objects[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects} >> /Contents ${7 + i * 2} 0 R >>`;
      objects[7 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });
    this.images.forEach(({ data, info }, k) => {
      const body = hex(data);
      objects[first + k] = `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /${info.colors === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${body.length} >>\nstream\n${body}\nendstream`;
    });
    let out = "%PDF-1.4\n"; const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out); // ASCII only, so string offsets equal byte offsets
  }
}
