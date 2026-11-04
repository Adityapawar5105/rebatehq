// The single door from the UI into the vault. Every command passes the role check
// (lib/roles/access.ts ACTION_CAP) before any query runs, so a role without a capability
// never receives the data behind it. The Web Worker and the browser test gate both use this.
import { ACTION_CAP } from "../roles/access";
import { storageStatus } from "./storage";
import { VaultError, type Request } from "./protocol";
import type { VaultService } from "./service";
export type Hooks = { signal: () => AbortSignal; progress: (stage: string, done: string, total: string) => void; unlocked?: () => void };
export async function dispatch(service: VaultService, request: Request, hooks: Hooks): Promise<unknown> {
  if (!(request.action in ACTION_CAP)) throw new VaultError("PROTOCOL", "Unsupported local command.");
  await service.guard(ACTION_CAP[request.action]);
  const { progress } = hooks;
  switch (request.action) {
    case "home": return service.home();
    case "checklist": return service.checklist();
    case "checklistMark": return service.checklistMark(request.data.step);
    case "roleList": return service.roleList();
    case "roleSet": return service.roleSet(request.data.userId, request.data.name, request.data.role);
    case "roleRemove": return service.roleRemove(request.data.userId);
    case "accessSet": return service.accessSet(request.data.repSeesCost);
    case "rolePreview": return service.rolePreview(request.data.role);
    case "cleanupScan": return service.cleanupScan();
    case "cleanupHistory": return service.cleanupHistory();
    case "cleanupApply": return service.cleanupApply(request.data.kind, request.data.key, request.data.target ?? null);
    case "cleanupUndo": return service.cleanupUndo(request.data.id);
    case "cleanupMergeAll": return service.cleanupMergeAll(progress);
    case "cleanupUndoMany": return service.cleanupUndoMany(request.data.ids);
    case "costBasis": return service.costBasis();
    case "costBasisSet": return service.costBasisSet(request.data.group, request.data.basis);
    case "pricingState": return service.pricingState();
    case "pricingOwner": return service.pricingOwner(request.data.name, request.data.userId, request.data.backupDays);
    case "guardSet": return service.guardSet(request.data.input);
    case "ruleSave": return service.ruleSave(request.data.input);
    case "ruleSimulate": return service.ruleSimulate(request.data.id);
    case "rulePreview": return service.rulePreview(request.data.id, request.data.offset);
    case "ruleApprove": return service.ruleApprove(request.data.id);
    case "priceExport": return service.priceExport(request.data.id, request.data.profile, request.data.format);
    case "backupStatus": return service.backupStatus();
    case "backupConfigure": return service.backupConfigure(request.data.directory, request.data.hours);
    case "backupNow": return service.backupNow();
    case "backupExport": return service.backupExport();
    case "backupRestore": return service.backupRestore(request.data.file, request.data.passphrase);
    case "init": return service.init(request.data.scope);
    case "create": {
      // A vault always starts with a named Pricing Owner; the worker refuses to create one without.
      if (typeof request.data.ownerName !== "string" || !request.data.ownerName.trim()) throw new VaultError("OWNER", "Name the Pricing Owner before creating the vault. That person approves every price change.");
      return service.create(request.data.passphrase, request.data.tier, request.data.ownerName);
    }
    case "unlock": { const result = await service.unlock(request.data.passphrase); hooks.unlocked?.(); return result; }
    case "lock": return service.lock();
    case "touch": return service.touch();
    case "status": return service.status();
    case "save": return service.save();
    case "verify": return service.verify();
    case "storage": return storageStatus();
    case "studioAdd": return service.studioAdd(request.data.files, request.data.replaces ?? null);
    case "studioUpdate": return service.studioUpdate(request.data.id, request.data.settings, request.data.role, { erp: request.data.erp, field: request.data.field, confirmed: request.data.confirmed });
    case "studioDrop": return service.studioDrop(request.data.id);
    case "studioClear": return service.studioClear();
    case "studioState": return service.studioState();
    case "studioPlan": return service.studioPlan(hooks.signal(), progress);
    case "studioCommit": return service.studioCommit(request.data.acknowledge, progress);
    case "studioDownload": return service.studioDownload(request.data.id, hooks.signal());
    case "studioZip": return service.studioZip(hooks.signal());
    case "recipeSave": return service.recipeSave(request.data.id, request.data.name);
    case "recipeApply": return service.recipeApply(request.data.id, request.data.recipeId);
    case "sources": return service.sources();
    case "sourceRemove": return service.sourceRemove(request.data.id);
    case "fixGroups": return service.fixGroups();
    case "fixRows": return service.fixRows(request.data.sourceId, request.data.code, request.data.offset ?? 0);
    case "fixSet": return service.fixSet(request.data.sourceId, request.data.code, request.data.field, request.data.value, request.data.rows ?? null);
    case "fixDismiss": return service.fixDismiss(request.data.sourceId, request.data.code, request.data.rows ?? null);
    case "fixRecheck": return service.fixRecheck(request.data.sourceId, request.data.code);
    case "health": return service.health();
    case "playgroundLoad": return service.playgroundLoad(progress);
    case "playgroundRemove": return service.playgroundRemove();
    case "creditsLoad": return service.creditsLoad(request.data.sourceId);
    case "marginWaterfall": return service.marginWaterfall(request.data.filters);
    case "marginDrill": return service.marginDrill(request.data.dim, request.data.filters, request.data.sort);
    case "marginWhale": return service.marginWhale(request.data.filters);
    case "marginMath": return service.marginMath(request.data.metric, request.data.filters, request.data.offset ?? 0);
    case "leaks": return service.leaks();
    case "leakRows": return service.leakRows(request.data.id, request.data.offset ?? 0);
    case "leakReport": return service.leakReport();
    case "roi": return service.roi();
    case "reconcile": return service.reconcile();
    case "reconAccept": return service.reconAccept(request.data.id ?? null);
    case "reconRebuild": return service.reconRebuild();
    default: throw new VaultError("PROTOCOL", "Unsupported local command.");
  }
}
