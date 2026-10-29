import {MAX_IMPORT_DATA_ROWS,IMPORT_HEADER_SCAN_ROWS} from "./import-config";
export const IMPORT_FIELDS = ["sku","description","unit","cost","price","supplier","date","quantity"] as const;
export type ImportField = typeof IMPORT_FIELDS[number];
export type ColumnMapping = Partial<Record<ImportField, number>>;
export type Cell = { value: string; kind: "text" | "number" | "date" | "boolean" | "formula" | "error" };
export type UploadRow = { row: number; cells: Cell[] };
export type UploadIssue = { code: string; row: number; column: string; message: string; sheet: string };
export type ParsedUpload = { fileType: "xlsx" | "csv" | "tsv"; sheets: { id: string; name: string; hidden: boolean }[]; sheetId: string; sheetName: string; headerRow: number; headers: string[]; mapping: ColumnMapping; rows: UploadRow[]; issues: UploadIssue[]; sourceHash: string };
export type UploadPreview = Omit<ParsedUpload,"rows"> & { rows: UploadRow[]; totalRows: number; jobId: string; headersFingerprint: string; limits: string;totalIssues?:number;issueOffset?:number;issuePageSize?:number };
export const UPLOAD_LIMITS = {
 bytes:Math.max(2*1024*1024,MAX_IMPORT_DATA_ROWS*1024),
 rows:MAX_IMPORT_DATA_ROWS+IMPORT_HEADER_SCAN_ROWS,columns:64,
 cells:(MAX_IMPORT_DATA_ROWS+IMPORT_HEADER_SCAN_ROWS)*64,cellChars:2000,
 issues:Math.max(8000,MAX_IMPORT_DATA_ROWS*12),zipEntries:128,
 expandedBytes:Math.max(12*1024*1024,MAX_IMPORT_DATA_ROWS*8192),
 partBytes:Math.max(4*1024*1024,MAX_IMPORT_DATA_ROWS*4096)
} as const;
