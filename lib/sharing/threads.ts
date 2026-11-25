// Team sharing S5a (SHARING_DESIGN.md section 8): comment threads and tasks on shared objects, an inbox and an activity
// feed, carried as relay events (no server change). The event's outer content is `{kind:'thread', pack, iv, body}`,
// readable by every member of the epoch; the body (target, text, task) is sealed again under the key of the pack the
// object belongs to, so a device without that pack key (a rep and every cost pack) cannot read it. The outer object kind
// is always THREAD_OBJECT_KIND and the object id is random, so the server learns neither the target nor the topic.
// The fold below is the only place thread rules live: the sender's device must hold the pack under that event's epoch,
// every mention and assignee must hold it too, and a target maps to exactly one pack (TARGET_PACK).
import { z } from "zod";
import { COST_PACKS, type AnyPack } from "./catalog";
import type { Epoch, RelayEvent } from "../relay/protocol";

/** What a thread can be about, and the pack whose key seals it. One table, tested: anything cost can be worked out from
 *  maps to a cost pack, so a role without cost never holds the key. */
export const TARGET_PACK = {
  item: "items",        // an SKU in the item master
  customer: "customers",
  price: "book",        // a book price line
  contract: "contracts",// a customer contract price line
  guardrail: "guards",
  quote: "book",        // a quote: prices only, as a rep sees them
  cost: "cost",         // an item's cost or a vendor cost
  leak: "cost",         // a leak finding (margin is worked out from cost)
  claim: "supplier",    // a supplier claim
  vendor: "supplier",   // a vendor price review
} as const satisfies Record<string, AnyPack>;
export type TargetType = keyof typeof TARGET_PACK;
export const TARGET_TYPES = Object.keys(TARGET_PACK) as TargetType[];
/** Every thread event uses this outer kind (the 7A relay allows three); the real target is inside the sealed body. */
export const THREAD_OBJECT_KIND: RelayEvent["objectKind"] = "price_change";
export const THREAD_TEXT_MAX = 2000;

const uuid = z.string().uuid().transform(s => s.toLowerCase());
const day = z.string().regex(/^\d{4}-\d\d-\d\d$/).refine(s => Number.isFinite(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s);
const text = z.string().trim().min(1).max(THREAD_TEXT_MAX);
export const TargetSchema = z.object({ type: z.enum(TARGET_TYPES as [TargetType, ...TargetType[]]), ref: z.array(z.string().min(1).max(160)).min(1).max(6), label: z.string().trim().min(1).max(160) }).strict();
export type Target = z.infer<typeof TargetSchema>;
const TaskSchema = z.object({ assignee: uuid.nullable(), due: day.nullable(), done: z.boolean() }).strict();
export type TaskState = z.infer<typeof TaskSchema>;
export const ThreadBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), target: TargetSchema, text, task: TaskSchema.nullable() }).strict(),
  z.object({ kind: z.literal("reply"), text }).strict(),
  z.object({ kind: z.literal("status"), resolved: z.boolean() }).strict(),
  z.object({ kind: z.literal("task"), task: TaskSchema }).strict(),
]);
export type ThreadBody = z.infer<typeof ThreadBodySchema>;
/** How a device holds a thread event's sealed body: read, not openable here (no key for that pack), or authentic but bad. */
export type SealedState = { state: "ok"; body: ThreadBody } | { state: "nokey" } | { state: "bad" };

export type Thread = {
  id: string; pack: AnyPack; target: Target; author: string; createdAt: string; updatedAt: string; sequence: string;
  resolved: boolean; task: TaskState | null;
  messages: { id: string; author: string; text: string; at: string; mentions: string[]; sequence: string }[];
  events: { id: string; author: string; at: string; sequence: string; kind: "open" | "reply" | "resolved" | "reopened" | "task" }[];
};
type Entry = { event: RelayEvent; content: { kind: string; pack?: string } | null; sealed?: SealedState };

/** The users whose device holds `pack` under `epoch` (from the signed per-device pack wraps). */
export function holders(epoch: Epoch, pack: string) {
  if (epoch.v !== "2") return new Set<string>();
  const devices = new Set(epoch.packWraps.filter(w => w.pack === pack).map(w => w.deviceId));
  return new Set(epoch.members.filter(m => devices.has(m.deviceId)).map(m => m.userId));
}
const deviceHolds = (epoch: Epoch, pack: string, deviceId: string) => epoch.v === "2" && epoch.packWraps.some(w => w.pack === pack && w.deviceId === deviceId);

/** Fold every thread event in log order. An event that breaks a rule is listed in `rejected` and changes nothing, so one
 *  member can never poison the log; events this device cannot open are skipped (their threads are not shown here). */
export function foldThreads(entries: Entry[], epochs: Epoch[]) {
  const threads = new Map<string, Thread>(), rejected: string[] = [], hidden = new Set<string>();
  for (const { event: e, content: c, sealed } of entries) {
    if (!c || c.kind !== "thread") continue;
    const epoch = epochs.find(p => p.id === e.epochId), pack = c.pack as AnyPack;
    const bad = () => rejected.push(e.id);
    if (!epoch || e.objectKind !== THREAD_OBJECT_KIND || !deviceHolds(epoch, pack, e.senderDevice)) { bad(); continue; }
    const allowed = holders(epoch, pack);
    if (e.mentions.some(u => !allowed.has(u))) { bad(); continue; }
    if (!sealed || sealed.state === "nokey") { hidden.add(e.objectId); continue; }
    if (sealed.state === "bad") { bad(); continue; }
    const b = sealed.body, t = threads.get(e.objectId);
    if (b.kind === "open") {
      if (t || hidden.has(e.objectId) || TARGET_PACK[b.target.type] !== pack || (b.task?.assignee && !allowed.has(b.task.assignee))) { bad(); continue; }
      threads.set(e.objectId, { id: e.objectId, pack, target: b.target, author: e.senderUser, createdAt: e.createdAt, updatedAt: e.createdAt, sequence: e.sequence, resolved: false, task: b.task,
        messages: [{ id: e.id, author: e.senderUser, text: b.text, at: e.createdAt, mentions: e.mentions, sequence: e.sequence }],
        events: [{ id: e.id, author: e.senderUser, at: e.createdAt, sequence: e.sequence, kind: "open" }] });
      continue;
    }
    // A thread this log never saw opened (it began before this device joined) is skipped, not rejected: a rejection would
    // show the sync status as a conflict on every device that joined later.
    if (!t) continue;
    if (t.pack !== pack) { bad(); continue; }
    if (b.kind === "reply") t.messages.push({ id: e.id, author: e.senderUser, text: b.text, at: e.createdAt, mentions: e.mentions, sequence: e.sequence });
    else if (b.kind === "status") { if (t.resolved === b.resolved) { bad(); continue; } t.resolved = b.resolved; }
    else { if (b.task.assignee && !allowed.has(b.task.assignee)) { bad(); continue; } t.task = b.task; }
    t.events.push({ id: e.id, author: e.senderUser, at: e.createdAt, sequence: e.sequence, kind: b.kind === "reply" ? "reply" : b.kind === "status" ? (b.resolved ? "resolved" : "reopened") : "task" });
    t.updatedAt = e.createdAt; t.sequence = e.sequence;
  }
  return { threads: [...threads.values()].sort((a, b) => BigInt(a.sequence) > BigInt(b.sequence) ? -1 : 1), rejected };
}

export type InboxItem = { thread: string; kind: "mention" | "task" | "reply"; sequence: string; at: string; from: string; text: string; target: Target; pack: AnyPack };
/** What needs this person: mentions of them, open tasks assigned to them, and replies by others in threads they wrote in. */
export function inboxFor(threads: Thread[], me: string) {
  const items: InboxItem[] = [];
  for (const t of threads) {
    const base = { thread: t.id, target: t.target, pack: t.pack };
    let joined = false;
    for (const m of [...t.messages].sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1)) {
      if (m.author === me) { joined = true; continue; }
      if (m.mentions.includes(me)) items.push({ ...base, kind: "mention", sequence: m.sequence, at: m.at, from: m.author, text: m.text.slice(0, 160) });
      else if (joined) items.push({ ...base, kind: "reply", sequence: m.sequence, at: m.at, from: m.author, text: m.text.slice(0, 160) });
    }
    if (t.task && !t.task.done && t.task.assignee === me) {
      const set = [...t.events].reverse().find(ev => ev.kind === "task" || ev.kind === "open")!;
      if (set.author !== me) items.push({ ...base, kind: "task", sequence: set.sequence, at: set.at, from: set.author, text: t.messages[0].text.slice(0, 160) });
    }
  }
  return items.sort((a, b) => BigInt(a.sequence) > BigInt(b.sequence) ? -1 : 1);
}
/** Threads a role may see in this vault: the device must hold the key, and a role without cost never sees a cost pack. */
export const visibleTo = (cost: boolean) => (t: Thread) => cost || !COST_PACKS.includes(t.pack);
