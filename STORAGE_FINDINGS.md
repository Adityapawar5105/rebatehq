# Chunk 4B storage investigation

3 November 2026, local evidence only. Ryzen 5 5600H, nominal 8 GB RAM,
Windows 11 build 10.0.26200. Chrome 156.0.8078.80; Edge 156.0.4314.58.

## What was tested

1. Fresh, separate browser profiles ran the production vault worker in the
   explicitly enabled synthetic `/lab/vault` harness. The test walks every
   named OPFS file: only ciphertext with the `MDVAULT1` header and bounded
   generation-pointer JSON may exist. No plaintext database/WAL/CSV is present.
2. `storage.estimate()` was compared with recursive `File.size` totals after
   100k-row imports and after seeded 1M/2M snapshots. Figures are in the browser
   evidence linked from `docs/evidence/CHUNK_4B_VERIFICATION.md`. In these runs the estimate
   was only a few kilobytes above named file sizes, rather than gigabytes.
3. In a fresh browser context, a dedicated worker used a **real** OPFS sync
   access handle for a synthetic eight-MiB zero-filled file. It wrote, flushed,
   truncated to 1 KiB, closed and deleted the file, reading the quota estimate
   at each stage. This diagnostic never touches a customer vault.

| Controlled sync-handle probe | Chrome usage bytes | Edge usage bytes |
|---|---:|---:|
| Before | 0 | 0 |
| After 8 MiB write + flush | 8,388,804 | 8,388,804 |
| After truncate to 1 KiB, handle still open | 1,220 | 1,220 |
| After close | 1,220 | 1,220 |
| After delete | 0 | 0 |

This small probe accounts for file bytes plus 196 bytes of metadata. Merely
holding a sync handle open did **not** reproduce the historical discrepancy.
The production vault never uses a real sync handle for its working database:
its DuckDB child worker replaces that bridge with a private RAM filesystem.
Only the outer worker writes encrypted files through atomic writable streams.
This differs from an OPFS library's "memory buffer" mode that still writes
through to disk; no backing OPFS directory is used by this RAM bridge.

## Finding and limits

The new ciphertext-only path does not reproduce 4A's approximately 4.14 GB
estimate against 68.18 MB of named OPFS files. This is evidence for the new
path, **not proof of the old cause or a fix for Chromium quota accounting**.
Chrome updated from 156.0.8078.76 in 4A to .80; Edge's version is unchanged.
The old discrepancy remains **unresolved/unverified**. No unsupported claim
about reserved capacity, hidden files or browser padding is made.

`estimate()` is an origin-wide estimate, not an exact disk-use invoice. The
spec permits implementation-specific estimates; named `File.size` totals
also omit metadata and temporary implementation files. See the
[Storage Standard](https://storage.spec.whatwg.org/#usage-and-quota) and
[File System Standard](https://fs.spec.whatwg.org/).

`persist()` was requested from the window's user action (it is not available
in the dedicated worker). Headless Chrome and Edge returned **not granted**;
the UI displays that result. A grant is browser-controlled and is not a backup.
Headed grants, real quota exhaustion, physical power loss and other OS/browser
versions remain **unverified**. Unit fault injection covers failed writes and
pointer swaps; a killed renderer verifies an already committed encrypted save.
