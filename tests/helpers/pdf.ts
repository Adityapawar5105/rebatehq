// A minimal, valid PDF written by hand for converter tests: Helvetica text placed at exact points, one content stream
// per page. `pages` lists, per page, [x, y, text] runs (PDF y grows upwards). An empty page list item gives a page with
// no text at all (the shape of a scanned page).
export function makePdf(pages: Array<Array<[number, number, string]>>): Uint8Array {
  const esc = (s: string) => s.replace(/[\()]/g, m => "\\" + m);
  const streams = pages.map(items => items.length ? "BT /F1 9 Tf " + items.map(([x, y, t]) => `1 0 0 1 ${x} ${y} Tm (${esc(t)}) Tj`).join(" ") + " ET" : "0 0 m 10 10 l S");
  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  streams.forEach((c, i) => { objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`); objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`); });
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
/** A table as PDF text runs: one row per line, 15 points apart, columns at the given x positions. */
export function tablePage(rows: string[][], xs: number[], top = 740): Array<[number, number, string]> {
  return rows.flatMap((cells, r) => cells.flatMap((t, c): Array<[number, number, string]> => t ? [[xs[c], top - r * 15, t]] : []));
}
