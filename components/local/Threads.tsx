"use client";
// Team sharing S5b (SHARING_DESIGN.md section 8): threads and tasks on shared objects. "Discuss" opens the threads about
// one object (an item, a customer, a quote, a leak finding, a supplier claim); the shared inbox gets a "Threads and tasks"
// tab with what needs this person, open tasks and the activity feed. Everything is read from the vault's relay log in the
// worker (threadList, inboxState, activityFeed); sending goes through the relay (relayThread*), encrypted under the key of
// the pack the object belongs to (lib/sharing/threads.ts).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { Target, TargetType, Thread } from "@/lib/sharing/threads";
import { TARGET_PACK } from "@/lib/sharing/threads";
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import { Badge, Button, Field, Notice } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";

const PACK_NAME: Record<string, MessageKey> = { items: "share.pack.items", customers: "share.pack.customers", book: "share.pack.book", contracts: "share.pack.contracts", guards: "share.pack.guards", cost: "share.pack.cost", cost_floors: "share.pack.cost_floors", supplier: "share.pack.supplier", rules: "share.pack.rules", competitors: "share.pack.competitors", documents: "share.pack.documents", results: "share.pack.results" };
export const TARGET_NAME: Record<TargetType, MessageKey> = { item: "thread.target.item", customer: "thread.target.customer", price: "thread.target.price", contract: "thread.target.contract", guardrail: "thread.target.guardrail", quote: "thread.target.quote", cost: "thread.target.cost", leak: "thread.target.leak", claim: "thread.target.claim", vendor: "thread.target.vendor" };
const ACTIVITY: Record<string, MessageKey> = { shared: "thread.act.shared", requested: "thread.act.requested", approved: "thread.act.approved", rejected: "thread.act.rejected", commented: "thread.act.commented", published: "thread.act.published", "thread.open": "thread.act.open", "thread.reply": "thread.act.reply", "thread.resolved": "thread.act.resolved", "thread.reopened": "thread.act.reopened", "thread.task": "thread.act.task" };
const INBOX_KIND: Record<string, MessageKey> = { mention: "thread.kind.mention", reply: "thread.kind.reply", task: "thread.kind.task" };
type List = Results["threadList"];
const packName = (p: string) => p in PACK_NAME ? t(PACK_NAME[p]) : p;
const errorText = (e: unknown) => e instanceof Error && e.message ? e.message : msg("relay.sharingCouldNotFinish");
/** Pages refresh their thread counts when the worker reports a relay change (the doorbell, a poll or a send). */
const REFRESH = "rebatehq:threads-changed";
export const threadsChanged = () => window.dispatchEvent(new Event(REFRESH));

/** Open threads per object of one target type, for a "Discuss" column (one worker read per grid, not per row). */
export function useThreadCounts(client: VaultClient, type: TargetType, version: string) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => { const go = () => setTick(x => x + 1); window.addEventListener(REFRESH, go); return () => window.removeEventListener(REFRESH, go); }, []);
  useEffect(() => {
    let on = true;
    void client.call("threadList", { target: null }).then(v => {
      if (!on) return;
      const m = new Map<string, number>();
      for (const x of v.threads) if (x.target.type === type && !x.resolved) { const k = JSON.stringify(x.target.ref); m.set(k, (m.get(k) ?? 0) + 1); }
      setCounts(m);
    }).catch(() => { if (on) setCounts(new Map()); });
    return () => { on = false; };
  }, [client, type, version, tick]);
  return useCallback((ref: string[]) => counts.get(JSON.stringify(ref)) ?? 0, [counts]);
}

/** A "Discuss" button that opens the threads about one object. */
export function Discuss({ client, userId, target, count = 0 }: { client: VaultClient; userId: string; target: Target; count?: number }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="ghost" icon="inbox" data-testid="thread-discuss" aria-label={t("thread.discussAbout", { label: target.label })} onClick={() => setOpen(true)}>
      {t("thread.discuss")}{count > 0 && <> <Badge tone="accent">{fmt.int(count)}</Badge></>}
    </Button>
    {open && <DiscussDialog client={client} userId={userId} target={target} onClose={() => setOpen(false)} />}
  </>;
}
/** Rendered only while open (a grid of fifty rows holds no fifty hidden dialogs), with its own heading id. */
function DiscussDialog({ client, userId, target, onClose }: { client: VaultClient; userId: string; target: Target; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { const d = dialog.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={dialog} className={styles.relayDialog} aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose(); }} data-testid="thread-dialog"
    onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <div className={styles.row}><h2 id={id} translate="no">{t("thread.title", { kind: t(TARGET_NAME[target.type]), label: target.label })}</h2>
      <Button onClick={onClose}>{t("thread.close")}</Button></div>
    <ThreadsFor client={client} userId={userId} target={target} />
  </dialog>;
}

/** The threads about one object (or, with `only`, one thread from the inbox), with replies, status and task editing. */
export function ThreadsFor({ client, userId, target, only }: { client: VaultClient; userId: string; target: Target | null; only?: string }) {
  const [list, setList] = useState<List | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { setList(await client.call("threadList", { target: target ? { type: target.type, ref: target.ref } : null })); setError(""); }
    catch (e) { setError(errorText(e)); }
  }, [client, target]);
  useEffect(() => { void load(); }, [load]);
  async function send<A extends "relayThreadOpen" | "relayThreadReply" | "relayThreadStatus" | "relayThreadTask">(action: A, data: Parameters<VaultClient["call"]>[1] & object, done: string) {
    setBusy(true); setError(""); setNote("");
    try { await client.call(action, data as never); setNote(done); await load(); threadsChanged(); return true; }
    catch (e) { setError(errorText(e)); return false; }
    finally { setBusy(false); }
  }
  if (!list) return error ? <Notice tone="bad" role="alert">{say(error)}</Notice> : <p role="status">{t("relay.workingInTheEncrypted")}</p>;
  const name = (id: string) => list.people.find(p => p.userId === id)?.name ?? id;
  if (!list.joined) return <Notice tone="info" data-testid="thread-not-joined">{t("thread.notJoined")}</Notice>;
  const threads = only ? list.threads.filter(x => x.id === only) : list.threads;
  const pack = target ? TARGET_PACK[target.type] : null;
  const held = !pack || list.held.includes(pack);
  return <div data-testid="thread-list">
    {error && <Notice tone="bad" role="alert">{say(error)}</Notice>}
    <p role="status" aria-live="polite">{busy ? t("relay.workingInTheEncrypted") : say(note)}</p>
    {!held && <Notice tone="info">{t("thread.notHeld", { pack: packName(pack!) })}</Notice>}
    {!threads.length && !only && <p className={styles.muted}>{t("thread.none")}</p>}
    {threads.map(x => <ThreadCard key={x.id} thread={x} userId={userId} name={name} readers={list.readers[x.pack] ?? []} busy={busy} send={send} showTarget={!target} />)}
    {target && held && !only && <NewThread target={target} userId={userId} name={name} readers={list.readers[pack!] ?? []} busy={busy} send={send} />}
  </div>;
}

type Send = (action: "relayThreadOpen" | "relayThreadReply" | "relayThreadStatus" | "relayThreadTask", data: never, done: string) => Promise<boolean>;
function Mentions({ people, me, value, onChange, name, pack }: { people: string[]; me: string; value: string[]; onChange: (v: string[]) => void; name: (id: string) => string; pack: string }) {
  const others = people.filter(p => p !== me);
  if (!others.length) return null;
  return <fieldset className={styles.relayChecks}><legend>{t("thread.mention")}</legend>
    <p className={styles.small}>{t("thread.mentionHint", { pack: packName(pack) })}</p>
    {others.map(p => <label key={p}><input type="checkbox" checked={value.includes(p)} onChange={e => onChange(e.target.checked ? [...value, p] : value.filter(v => v !== p))} /><span translate="no">@{name(p)}</span></label>)}
  </fieldset>;
}
function TaskFields({ people, name, assignee, setAssignee, due, setDue }: { people: string[]; name: (id: string) => string; assignee: string; setAssignee: (v: string) => void; due: string; setDue: (v: string) => void }) {
  return <div className={styles.row}>
    <Field label={t("thread.assignee")}><select value={assignee} onChange={e => setAssignee(e.target.value)} data-testid="thread-assignee"><option value="">{t("thread.nobody")}</option>{people.map(p => <option key={p} value={p}>{name(p)}</option>)}</select></Field>
    <Field label={t("thread.due")}><input type="date" value={due} onChange={e => setDue(e.target.value)} /></Field>
  </div>;
}
function NewThread({ target, userId, name, readers, busy, send }: { target: Target; userId: string; name: (id: string) => string; readers: string[]; busy: boolean; send: Send }) {
  const [text, setText] = useState(""), [mentions, setMentions] = useState<string[]>([]), [task, setTask] = useState(false), [assignee, setAssignee] = useState(""), [due, setDue] = useState("");
  return <form data-testid="thread-new" onSubmit={e => { e.preventDefault(); void send("relayThreadOpen", { target, text, mentions, task: task ? { assignee: assignee || null, due: due || null, done: false } : null } as never, msg("thread.sent")).then(ok => { if (ok) { setText(""); setMentions([]); setTask(false); setAssignee(""); setDue(""); } }); }}>
    <h3>{t("thread.new")}</h3>
    <Field label={t("thread.text")}><textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} required rows={3} /></Field>
    <Mentions people={readers} me={userId} value={mentions} onChange={setMentions} name={name} pack={TARGET_PACK[target.type]} />
    <label className={styles.row}><input type="checkbox" checked={task} onChange={e => setTask(e.target.checked)} />{t("thread.makeTask")}</label>
    {task && <TaskFields people={readers} name={name} assignee={assignee} setAssignee={setAssignee} due={due} setDue={setDue} />}
    <Button variant="primary" type="submit" disabled={busy || !text.trim()}>{t("thread.send")}</Button>
  </form>;
}
function ThreadCard({ thread: x, userId, name, readers, busy, send, showTarget }: { thread: Thread; userId: string; name: (id: string) => string; readers: string[]; busy: boolean; send: Send; showTarget: boolean }) {
  const [text, setText] = useState(""), [mentions, setMentions] = useState<string[]>([]);
  const [assignee, setAssignee] = useState(x.task?.assignee ?? ""), [due, setDue] = useState(x.task?.due ?? ""), [editTask, setEditTask] = useState(false);
  return <article className={styles.threadCard} data-testid="thread-card" data-thread={x.id}>
    <div className={styles.row}>
      {showTarget && <strong translate="no">{t(TARGET_NAME[x.target.type])}: {x.target.label}</strong>}
      <Badge tone={x.resolved ? "ok" : "accent"}>{t(x.resolved ? "thread.resolved" : "thread.open")}</Badge>
      {x.task && <Badge tone={x.task.done ? "ok" : "warn"} data-testid="thread-task">{x.task.done ? t("thread.taskDone") : x.task.assignee ? (x.task.due ? t("thread.taskFor", { name: name(x.task.assignee), date: fmt.date(x.task.due) }) : t("thread.taskForNoDue", { name: name(x.task.assignee) })) : t("thread.task")}</Badge>}
    </div>
    {x.messages.map(m => <p key={m.id}><strong translate="no">{name(m.author)}</strong>{t("common.definitionSeparator")}<span translate="no">{m.text}</span> <span className={styles.small}>{fmt.dateTime(m.at)}</span>{m.mentions.includes(userId) && <> <Badge tone="accent">{t("relay.mentionsYou")}</Badge></>}</p>)}
    <form onSubmit={e => { e.preventDefault(); void send("relayThreadReply", { id: x.id, text, mentions } as never, msg("thread.sent")).then(ok => { if (ok) { setText(""); setMentions([]); } }); }}>
      <Field label={t("thread.reply")}><textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000} rows={2} required /></Field>
      <Mentions people={readers} me={userId} value={mentions} onChange={setMentions} name={name} pack={x.pack} />
      <div className={styles.row}>
        <Button variant="primary" type="submit" disabled={busy || !text.trim()}>{t("thread.send")}</Button>
        <Button disabled={busy} onClick={() => void send("relayThreadStatus", { id: x.id, resolved: !x.resolved } as never, msg(x.resolved ? "thread.reopened" : "thread.resolvedNote"))}>{t(x.resolved ? "thread.reopen" : "thread.resolve")}</Button>
        {x.task && !x.task.done && <Button disabled={busy} onClick={() => void send("relayThreadTask", { id: x.id, task: { ...x.task!, done: true } } as never, msg("thread.taskSaved"))}>{t("thread.markDone")}</Button>}
        <Button variant="ghost" disabled={busy} onClick={() => setEditTask(v => !v)}>{t(x.task ? "thread.editTask" : "thread.makeTask")}</Button>
      </div>
    </form>
    {editTask && <form onSubmit={e => { e.preventDefault(); void send("relayThreadTask", { id: x.id, task: { assignee: assignee || null, due: due || null, done: x.task?.done ?? false } } as never, msg("thread.taskSaved")).then(ok => { if (ok) setEditTask(false); }); }}>
      <TaskFields people={readers} name={name} assignee={assignee} setAssignee={setAssignee} due={due} setDue={setDue} />
      <Button type="submit" disabled={busy}>{t("thread.saveTask")}</Button>
    </form>}
  </article>;
}

type Inbox = Results["inboxState"];
type Feed = Results["activityFeed"];
/** The shared inbox's "Threads and tasks" tab: what needs this person, open tasks and the activity feed. */
export function ThreadsInbox({ client, userId, onUnread }: { client: VaultClient; userId: string; onUnread?: (n: number) => void }) {
  const [inbox, setInbox] = useState<Inbox | null>(null), [feed, setFeed] = useState<Feed | null>(null), [error, setError] = useState(""), [opened, setOpened] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const [i, f] = await Promise.all([client.call("inboxState", {}), client.call("activityFeed", {})]); setInbox(i); setFeed(f); onUnread?.(Number(i.unread)); setError(""); }
    catch (e) { setError(errorText(e)); }
  }, [client, onUnread]);
  useEffect(() => { void load(); const go = () => void load(); window.addEventListener(REFRESH, go); return () => window.removeEventListener(REFRESH, go); }, [load]);
  const name = useMemo(() => (id: string) => inbox?.people.find(p => p.userId === id)?.name ?? feed?.people.find(p => p.userId === id)?.name ?? id, [inbox, feed]);
  if (error) return <Notice tone="bad" role="alert">{say(error)}</Notice>;
  if (!inbox || !feed) return <p role="status">{t("relay.workingInTheEncrypted")}</p>;
  if (!inbox.joined) return <Notice tone="info">{t("thread.notJoined")}</Notice>;
  return <section data-testid="threads-inbox">
    <div className={styles.row}><h3>{t("thread.inbox")}</h3><Badge tone={inbox.unread === "0" ? "ok" : "accent"} data-testid="threads-unread">{t("thread.unread", { count: Number(inbox.unread) })}</Badge>
      <Button size="sm" disabled={inbox.unread === "0"} onClick={() => void client.call("inboxSeen", {}).then(i => { setInbox(i); onUnread?.(0); threadsChanged(); }).catch(e => setError(errorText(e)))}>{t("thread.markRead")}</Button></div>
    {!inbox.items.length && <p className={styles.muted}>{t("thread.inboxEmpty")}</p>}
    <DataGrid label={t("thread.inbox")} rows={inbox.items} rowKey={r => `${r.thread}:${r.sequence}:${r.kind}`} columns={[
      { id: "at", name: t("thread.col.when"), type: "date", value: r => r.at, cell: r => fmt.dateTime(r.at) },
      { id: "kind", name: t("thread.col.what"), value: r => r.kind, label: v => v in INBOX_KIND ? t(INBOX_KIND[v]) : v, cell: r => t(INBOX_KIND[r.kind]) },
      { id: "from", name: t("thread.col.who"), value: r => name(r.from) },
      { id: "about", name: t("thread.col.about"), value: r => `${t(TARGET_NAME[r.target.type])}: ${r.target.label}` },
      { id: "text", name: t("thread.col.message"), value: r => r.text },
      { id: "open", name: t("thread.show"), cell: r => <Button size="sm" onClick={() => setOpened(r.thread)}>{t("thread.show")}</Button> },
    ]} />
    {opened && <div data-testid="thread-opened"><ThreadsFor client={client} userId={userId} target={null} only={opened} /><Button size="sm" variant="ghost" onClick={() => setOpened(null)}>{t("thread.close")}</Button></div>}
    <h3>{t("thread.tasks")}</h3>
    {!inbox.tasks.length && <p className={styles.muted}>{t("thread.tasksEmpty")}</p>}
    <DataGrid label={t("thread.tasks")} rows={inbox.tasks} rowKey={r => r.id} columns={[
      { id: "due", name: t("thread.col.due"), type: "date", value: r => r.task?.due ?? null, cell: r => r.task?.due ? fmt.date(r.task.due) : "" },
      { id: "assignee", name: t("thread.col.assignee"), value: r => r.task?.assignee ? name(r.task.assignee) : t("thread.nobody") },
      { id: "about", name: t("thread.col.about"), value: r => `${t(TARGET_NAME[r.target.type])}: ${r.target.label}` },
      { id: "text", name: t("thread.col.message"), value: r => r.messages[0].text },
      { id: "open", name: t("thread.show"), cell: r => <Button size="sm" onClick={() => setOpened(r.id)}>{t("thread.show")}</Button> },
    ]} />
    <h3>{t("thread.activity")}</h3>
    {!feed.items.length && <p className={styles.muted}>{t("thread.activityEmpty")}</p>}
    <DataGrid label={t("thread.activity")} rows={feed.items.map((r, i) => ({ ...r, i }))} rowKey={r => String(r.i)} columns={[
      { id: "at", name: t("thread.col.when"), type: "date", value: r => r.at, cell: r => fmt.dateTime(r.at) },
      { id: "who", name: t("thread.col.who"), value: r => name(r.who) },
      { id: "what", name: t("thread.col.what"), value: r => r.kind, label: v => v in ACTIVITY ? t(ACTIVITY[v], { pack: "" }) : v, cell: r => t(ACTIVITY[r.kind] ?? "thread.act.commented", { pack: r.pack ? packName(r.pack) : "" }) },
      { id: "about", name: t("thread.col.about"), value: r => r.label },
    ]} />
    <p className={styles.small}>{t("thread.emailOff")}</p>
  </section>;
}
