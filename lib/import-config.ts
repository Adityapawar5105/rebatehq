// Change this one constant to configure the maximum data rows per supplier file.
// Run the boundary/performance tests after changing it; this is a build setting.
export const MAX_IMPORT_DATA_ROWS = 10_000;
export const IMPORT_BATCH_SIZE = 250;
export const IMPORT_PREVIEW_PAGE_SIZE = 100;
export const IMPORT_HEADER_SCAN_ROWS = 25;
export const MAX_IMPORT_JOURNAL_BYTES = Math.max(8*1024*1024,MAX_IMPORT_DATA_ROWS*8192);
export function* importBatches<T>(rows:readonly T[]):Generator<T[]>{
 for(let i=0;i<rows.length;i+=IMPORT_BATCH_SIZE)yield rows.slice(i,i+IMPORT_BATCH_SIZE);
}
