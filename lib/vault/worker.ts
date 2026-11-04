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
    case 'pricingState': result=await service.pricingState();break;
    case 'pricingOwner': result=await service.pricingOwner(request.data.name,request.data.userId,request.data.backupDays);break;
    case 'guardSet': result=await service.guardSet(request.data.input);break;
    case 'ruleSave': result=await service.ruleSave(request.data.input);break;
    case 'ruleSimulate': result=await service.ruleSimulate(request.data.id);break;
    case 'rulePreview': result=await service.rulePreview(request.data.id,request.data.offset);break;
    case 'ruleApprove': result=await service.ruleApprove(request.data.id);break;
    case 'priceExport': result=await service.priceExport(request.data.id,request.data.profile,request.data.format);break;
    case 'backupStatus': result=await service.backupStatus();break;
    case 'backupConfigure': result=await service.backupConfigure(request.data.directory,request.data.hours);break;
    case 'backupNow': result=await service.backupNow();break;
    case 'backupExport': result=await service.backupExport();break;
    case 'backupRestore': result=await service.backupRestore(request.data.file,request.data.passphrase);break;
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
    case "studioUpdate": result = await service.studioUpdate(request.data.id, request.data.settings, request.data.role, { erp: request.data.erp, field: request.data.field, confirmed: request.data.confirmed }); break;
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
    case "fixGroups": result = await service.fixGroups(); break;
    case "fixRows": result = await service.fixRows(request.data.sourceId, request.data.code, request.data.offset ?? 0); break;
    case "fixSet": result = await service.fixSet(request.data.sourceId, request.data.code, request.data.field, request.data.value, request.data.rows ?? null); break;
    case "fixDismiss": result = await service.fixDismiss(request.data.sourceId, request.data.code, request.data.rows ?? null); break;
    case "fixRecheck": result = await service.fixRecheck(request.data.sourceId, request.data.code); break;
    case "health": result = await service.health(); break;
    case "playgroundLoad": result = await service.playgroundLoad(progress); break;
    case "playgroundRemove": result = await service.playgroundRemove(); break;
    case "creditsLoad": result = await service.creditsLoad(request.data.sourceId); break;
    case "marginWaterfall": result = await service.marginWaterfall(request.data.filters); break;
    case "marginDrill": result = await service.marginDrill(request.data.dim, request.data.filters, request.data.sort); break;
    case "marginWhale": result = await service.marginWhale(request.data.filters); break;
    case "marginMath": result = await service.marginMath(request.data.metric, request.data.filters, request.data.offset ?? 0); break;
    case "leaks": result = await service.leaks(); break;
    case "leakRows": result = await service.leakRows(request.data.id, request.data.offset ?? 0); break;
    case "leakReport": result = await service.leakReport(); break;
    case "roi": result = await service.roi(); break;
    case "reconcile": result = await service.reconcile(); break;
    case "reconAccept": result = await service.reconAccept(request.data.id ?? null); break;
    case "reconRebuild": result = await service.reconRebuild(); break;
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

// Scheduled work is serialized with every mutation and runs only while unlocked.
setInterval(()=>{queue=queue.then(()=>service.backupDue()).catch(()=>undefined);},60_000);
