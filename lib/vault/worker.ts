/// <reference lib="webworker" />
import { VaultService } from "./service";
import { dispatch } from "./dispatch";
import { StudioError } from "../studio/formats";
import { VaultError, type Request, type Response } from "./protocol";
import {RelayError} from '../relay/protocol';
import { msg } from "../i18n/core";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (value: Response) => scope.postMessage(value);
let queue = Promise.resolve(), abort = new AbortController();
const service = new VaultService(() => {
  abort.abort(); void service.engine?.conn.cancelSent();
  queue = queue.then(async () => { const saved = await service.autoLock(); post({ event: "locked", reason: saved ? msg("vault.worker.lockedAfter10Minutes") : msg("vault.worker.autoLockedTheLast") }); });
});
const progress = (stage: string, done: string, total: string) => post({ event: "progress", stage, done, total });
function cancellable() { return abort.signal; }
async function handle(request: Request) {
  abort = new AbortController(); // each request gets its own cancellation scope
  const result = await dispatch(service, request, { signal: cancellable, progress, unlocked: () => { void service.warmup()?.then(() => post({ event: "writable" })); } });
  post({ id: request.id, action: request.action, result } as Response);
}
scope.onmessage = event => {
  const request = event.data as Request;
  if (!request || typeof request.id !== "string" || !request.data || typeof request.action !== "string") return;
  if (request.action === "cancel") { abort.abort(); void service.engine?.conn.cancelSent(); post({ id: request.id, action: "cancel", result: { ok: true } }); return; }
  if (request.action === "lock") { abort.abort(); void service.engine?.conn.cancelSent(); }
  queue = queue.then(() => handle(request)).catch(error => {
    // Only our own fixed messages cross the boundary; engine errors can embed cell values.
    const own = error instanceof VaultError || error instanceof StudioError || error instanceof RelayError;
    const cancelled = abort.signal.aborted && !own;
    post({ id: request.id, error: { code: error instanceof VaultError || error instanceof RelayError ? error.code : cancelled ? "CANCELLED" : own ? "STUDIO" : "LOCAL", message: own ? error.message : cancelled ? request.action.startsWith('sim') ? msg("sim.cancelled") : request.action.startsWith('relay') ? msg("vault.worker.sharingCancelledSyncTo") : msg("vault.worker.importCancelledNoRows") : msg("vault.worker.theLocalOperationFailed") } });
  });
};

// Scheduled work is serialized with every mutation and runs only while unlocked.
setInterval(()=>{queue=queue.then(()=>service.backupDue()).catch(()=>undefined);},60_000);

