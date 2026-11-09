// pdf.js ships no types for its worker module. RebateHQ only hands the module to pdf.js (globalThis.pdfjsWorker), so
// pdf.js runs its worker code inside the vault worker instead of starting another Worker (lib/studio/pdf.ts).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
