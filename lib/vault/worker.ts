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
// Requests from the page that are queued or running. The idle lock never cancels one of them (audit B-8): it waits
// until they end, then warns and locks a minute later unless the person comes back.
let inFlight = 0, lockAfterWork = false;
const service = new VaultService(() => {
  if (inFlight > 0) { lockAfterWork = true; return; }
  queue = queue.then(async () => { const saved = await service.autoLock(); post({ event: "locked", reason: saved ? msg("vault.worker.lockedAfter10Minutes") : msg("vault.worker.autoLockedTheLast") }); });
}, undefined, undefined, undefined, () => post({ event: "locking" }));
const progress = (stage: string, done: string, total: string, kind?: import("../studio/studio").ProgressKind) => post({ event: "progress", stage, done, total, ...(kind ? { kind } : {}) });
function cancellable() { return abort.signal; }
async function handle(request: Request) {
  abort = new AbortController(); // each request gets its own cancellation scope
  const result = await dispatch(service, request, { signal: cancellable, progress, unlocked: () => { void service.warmup()?.then(() => { post({ event: "writable" }); agentsDue(); relayDue(); }); } });
  post({ id: request.id, action: request.action, result } as Response);
}
scope.onmessage = event => {
  const request = event.data as Request;
  if (!request || typeof request.id !== "string" || !request.data || typeof request.action !== "string") return;
  if (request.action === "cancel") { abort.abort(); void service.engine?.conn.cancelSent(); post({ id: request.id, action: "cancel", result: { ok: true } }); return; }
  if (request.action === "lock") { abort.abort(); void service.engine?.conn.cancelSent(); }
  if (request.action === "touch") lockAfterWork = false; // the person came back during a long job
  inFlight++;
  queue = queue.then(() => handle(request)).catch(error => {
    // Only our own fixed messages cross the boundary; engine errors can embed cell values.
    const own = error instanceof VaultError || error instanceof StudioError || error instanceof RelayError;
    const cancelled = abort.signal.aborted && !own;
    post({ id: request.id, error: { code: error instanceof VaultError || error instanceof RelayError ? error.code : cancelled ? "CANCELLED" : error instanceof StudioError ? error.code : own ? "STUDIO" : "LOCAL", message: own ? error.message : cancelled ? request.action.startsWith('sim') ? msg("sim.cancelled") : request.action.startsWith('relay') ? msg("vault.worker.sharingCancelledSyncTo") : msg("vault.worker.importCancelledNoRows") : msg("vault.worker.theLocalOperationFailed") } });
  }).finally(() => {
    inFlight--;
    if (inFlight === 0 && lockAfterWork) { lockAfterWork = false; service.graceLock(); }
  });
};

// Scheduled work is serialized with every mutation and runs only while unlocked.
// 8B-1: Margin Drain agents run on their saved schedule while the app is open, queued like any other work.
const agentsDue = () => { queue = queue.then(() => service.agentsDue()).then(ran => { if (ran) post({ event: "agents" }); }).catch(() => undefined); };
// Roadmap 15.1: the folder pickup joins the same tick; a check that added files tells the page.
const pickupDue = () => { queue = queue.then(() => service.folderPickupDue()).then(async result => { if (result && (result.added || result.error)) post({ event: "pickup", result, name: (await service.folderGet()).name }); }).catch(() => undefined); };
// Team sharing S4: the 60-second poll of a joined device, and an immediate sync when the Realtime doorbell rings (one
// publish rings once per pack, so rings within a second and a half become one sync).
const relayDue = (ring = false) => { queue = queue.then(() => service.relayBackground(ring)).then(changed => { if (changed) post({ event: "relay" }); }).catch(() => undefined); };
let ringTimer: ReturnType<typeof setTimeout> | null = null;
service.onRelayRing(() => { if (ringTimer) return; ringTimer = setTimeout(() => { ringTimer = null; relayDue(true); }, 1500); });
setInterval(()=>{queue=queue.then(()=>service.backupDue()).catch(()=>undefined);agentsDue();pickupDue();relayDue();},60_000);

