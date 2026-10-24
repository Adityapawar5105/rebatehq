export function csvSafeCell(input: unknown): string {
  const value = String(input ?? "");
  return /^[\s\uFEFF]*[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}
export function csvRow(values: unknown[]): string {
  return values.map((value) => `"${csvSafeCell(value).replaceAll('"', '""')}"`).join(",");
}
export function csvDocument(headers: string[], rows: unknown[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join("\r\n");
}
