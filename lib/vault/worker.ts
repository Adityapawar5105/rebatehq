/// <reference lib="webworker" />
import { VaultService } from "./service";
import { storageStatus } from "./storage";
import { VaultError, type Request, type Response } from "./protocol";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (value: Response) => scope.postMessage(value);
let queue = Promise.resolve(), abort = new AbortController();
const service = new VaultService(() => {
  abort.abort(); void service.engine?.conn.cancelSent();
  queue = queue.then(async () => { const saved = await service.autoLock(); post({ event: "locked", reason: saved ? "Locked after 10 minutes of inactivity." : "Auto-locked. The last unsaved change could not be saved; the previous encrypted snapshot is safe." }); });
});
async function handle(request: Request) {
  let result: unknown;
  switch (request.action) {
    case "init": result = await service.init(request.data.scope); break;
    case "create": result = await service.create(request.data.passphrase, request.data.tier); break;
    case "unlock": result = await service.unlock(request.data.passphrase); break;
    case "lock": result = await service.lock(); break;
    case "touch": result = service.touch(); break;
    case "status": result = await service.status(); break;
    case "estimate": result = service.estimate(request.data.file); break;
    case "import": abort = new AbortController(); result = await service.import(request.data.file, request.data.confirmed, abort.signal, (stage, done, total) => post({ event: "progress", stage, done, total })); break;
    case "save": result = await service.save(); break;
    case "verify": result = await service.verify(); break;
    case "storage": result = await storageStatus(); break;
    default: throw new VaultError("PROTOCOL", "Unsupported local command.");
  }
  post({ id: request.id, action: request.action, result } as Response);
}
scope.onmessage = event => {
  const request = event.data as Request;
  if (!request || typeof request.id !== "string" || !request.data || typeof request.action !== "string") return;
  if (request.action === "cancel") { abort.abort(); void service.engine?.conn.cancelSent(); post({ id: request.id, action: "cancel", result: { ok: true } }); return; }
  if (request.action === "lock") { abort.abort(); void service.engine?.conn.cancelSent(); }
  queue = queue.then(() => handle(request)).catch(error => {
    post({ id: request.id, error: { code: error instanceof VaultError ? error.code : "LOCAL", message: error instanceof VaultError ? error.message : "The local operation failed. No source values were logged. Keep this tab open if a save is pending." } });
  });
};
