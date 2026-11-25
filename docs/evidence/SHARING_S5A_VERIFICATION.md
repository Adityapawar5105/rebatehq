# Team sharing S5a: threads, tasks, inbox and activity (worker) — verification

Built by Claude Code on 26 November 2026 from `SHARING_DESIGN.md` section 8. S5a covers the relay protocol, the worker and their tests; S5b adds the screens and the browser gate. There is **no server change** and no vault schema change.

## What it does

**Thread events ride the 7A relay** (`lib/sharing/threads.ts`, `lib/relay/crypto.ts`, `lib/relay/session.ts`):
- **The outer content** is a new kind, `{kind: 'thread', pack, iv, body}`, encrypted under the epoch's workspace key like every relay event.
- **The body** (target, text, task) is sealed again under the key of the pack its object belongs to. The seal is bound to the event id, workspace, epoch, thread id, pack and sender, so a body cannot be moved to another event, thread, pack or sender.
- **The outer object kind** is always `price_change`, one of the three the locked 7A migration allows. The object id is random, so the server learns neither the target nor the topic.

**Targets and packs** (`TARGET_PACK`, one table with a test):

| Target | Pack | Cost pack |
|---|---|---|
| item | items | no |
| customer | customers | no |
| price | book | no |
| contract | contracts | no |
| guardrail | guards | no |
| quote | book | no |
| cost | cost | yes |
| leak | cost | yes |
| claim | supplier | yes |
| vendor | supplier | yes |

**Rules, enforced in the fold** (`foldThreads`), with a rejected event changing nothing:
- The sender's device must hold the pack under that event's epoch, from the signed per-device pack wraps.
- Every mention and every assignee must hold the pack.
- A thread opens once, and its target must map to the pack it was sealed under.
- Replies, status changes and task changes must name an existing thread of the same pack.
- Resolving a resolved thread, or reopening an open one, is refused.

The session checks the same rules before it posts anything. A body this device cannot open (no key for that pack) is kept as `nokey`, and its thread is not shown.

**An older version of the app** quarantined the new content kind as unreadable. The next sync on this version reads those events again.

**Worker commands** (`lib/vault/service.ts`):
- **Local reads, no network:**
  - `threadList`: threads per object, with names from Team and roles and, per pack, who can be mentioned;
  - `inboxState`: mentions, replies in threads you wrote in and tasks assigned to you, with the unread count since `inboxSeen`, plus open tasks by due date;
  - `activityFeed`: shares, approvals, comments, thread events, and the shared data received through the relay.
- **Writes:**
  - `inboxSeen` (local);
  - `relayThreadOpen`, `relayThreadReply`, `relayThreadStatus` and `relayThreadTask` (relay).
- **Decision 16:**
  - a role without cost never sees a cost pack's threads, readers or receipts, even on a device that holds the key;
  - it cannot open a thread on a cost object.
- **Classification:** every new write is `NOT_GOVERNED`, so a read-only receiving seat can still discuss shared data. Every rep-reachable command is classified in the decision 16 test.

## Known limits

- **Every member's device fetches every event,** because the 7A relay does not filter by recipient. A rep's device therefore holds the ciphertext of cost threads and knows that one exists, but cannot open it. Nothing of a cost thread is stored readable on the rep's device.
- **The 7A caps cover threads too:** 10,000 events and 16 MiB per workspace, for its lifetime, in the locked migration.
- **Threads from before a device joined,** or sealed under a pack key the device never held for that epoch, stay unreadable to it.
- **Email notices are not built.** They need an email sender on the domain, which the product owner sets up. Until then there is no send path, dependency or setting.
- **"Who's viewing" is not built** (off by design).

## Checks run locally (not CI evidence)

`tests/relay-threads.test.ts` (5 tests, real relay sessions in PGlite):
- **Target map:** one pack per target, and cost-derived targets map to cost packs.
- **Seal:** the body opens only with its pack key and only for its event, thread, pack, sender and epoch; text over 2,000 characters is refused.
- **Sessions with an Owner, a Sales Manager and a rep:**
  - an item thread with a mention;
  - a leak thread the rep's device stores only as `nokey`, with no plaintext;
  - the rep cannot open a cost thread, and nobody can mention or assign the rep on one;
  - replies, a task for the rep, done, resolved, and resolving twice refused;
  - 7A references keep working beside threads, and the sync status stays `synced`;
  - only ciphertext is in `relay_event`;
  - events quarantined by an older app are read again;
  - the fold rejects an event from a device without the pack and a mention of someone who cannot read it.
- **Vault reads:**
  - a thread list per object;
  - the inbox with 2 unread, then 0 after `inboxSeen`;
  - the task list;
  - the activity feed without the cost thread for a rep;
  - the vault role filters cost threads even on a device holding the key.
- **Classification:** reads are local and writes are relay state, never governed.

## CI

[CI #263](https://github.com/Adityapawar5105/rebatehq/actions/runs/45687045923) passed on `3f0cbe2` (PR #40), 25 November 2026: unit tests, audit and build; database tests and the Chromium privacy and relay gates (real Supabase, `--auth`); the Firefox lab gate; and `verify`. PR #40 was merged into `main`.

Two automated security-review findings were fixed before the merge:
- replies, status and task changes now carry the same cost check as opening a thread;
- the check runs inside the session after its sync, so it also covers a thread that arrives with that sync, and refuses a thread it cannot find.
