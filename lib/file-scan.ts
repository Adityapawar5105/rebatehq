export type ScanResult={status:"clean"|"not_configured";message:string};
// Hook for a managed malware-scanning service before accepting spreadsheet uploads.
// Phase 1 stores no uploaded files; parsers run in memory with strict size/row limits.
export async function scanUpload(_bytes:Uint8Array):Promise<ScanResult>{return{status:"not_configured",message:"No file is persisted. Add a managed virus-scanning provider before enabling stored uploads."}}
