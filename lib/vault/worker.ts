/// <reference lib="webworker" />
import { VaultService } from "./service";
import { storageStatus } from "./storage";
import { StudioError } from "../studio/formats";
import { VaultError, type Request, type Response } from "./protocol";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (value: Response) => scope.postMessage(value);
let queue = Promise.resolve(), abort = new AbortController();
const service = new VaultService(() => {
  abort.abort(); void service.engine?.conn.cancelSent();
  queue = queue.then(async () => { const saved = await service.autoLock(); post({ event: "locked", reason: saved ? "Locked after 10 minutes of inactivity." : "Auto-locked. The last unsaved change could not be saved; the previous encrypted snapshot is safe." }); });
});
const progress = (stage: string, done: string, total: string) => post({ event: "progress", stage, done, total });
function cancellable() { return abort.signal; }
async function handle(request: Request) {
  abort = new AbortController(); // each request gets its own cancellation scope
  let result: unknown;
  switch (request.action) {
    case "init": result = await service.init(request.data.scope); break;
    case "create": result = await service.create(request.data.passphrase, request.data.tier); break;
    case "unlock": {
      result = await service.unlock(request.data.passphrase);
      void service.warmup()?.then(() => post({ event: "writable" }));
      break;
    }
    case "lock": result = await service.lock(); break;
    case "touch": result = service.touch(); break;
    case "status": result = await service.status(); break;
    case "save": result = await service.save(); break;
    case "verify": result = await service.verify(); break;
    case "storage": result = await storageStatus(); break;
    case "studioAdd": result = await service.studioAdd(request.data.files, request.data.replaces ?? null); break;
    case "studioUpdate": result = await service.studioUpdate(request.data.id, request.data.settings, request.data.role); break;
    case "studioDrop": result = await service.studioDrop(request.data.id); break;
    case "studioClear": result = await service.studioClear(); break;
    case "studioState": result = await service.studioState(); break;
    case "studioPlan": result = await service.studioPlan(cancellable(), progress); break;
    case "studioCommit": result = await service.studioCommit(request.data.acknowledge, progress); break;
    case "studioDownload": result = await service.studioDownload(request.data.id, cancellable()); break;
    case "studioZip": result = await service.studioZip(cancellable()); break;
    case "recipeSave": result = await service.recipeSave(request.data.id, request.data.name); break;
    case "recipeApply": result = await service.recipeApply(request.data.id, request.data.recipeId); break;
    case "sources": result = await service.sources(); break;
    case "sourceRemove": result = await service.sourceRemove(request.data.id); break;
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
    // Only our own fixed messages cross the boundary; engine errors can embed cell values.
    const own = error instanceof VaultError || error instanceof StudioError;
    const cancelled = abort.signal.aborted && !own;
    post({ id: request.id, error: { code: error instanceof VaultError ? error.code : cancelled ? "CANCELLED" : own ? "STUDIO" : "LOCAL", message: own ? error.message : cancelled ? "Import cancelled. No rows were committed." : "The local operation failed. No source values were logged. Keep this tab open if a save is pending." } });
  });
};
