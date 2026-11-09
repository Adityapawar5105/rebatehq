# Vendored DuckDB extensions

`v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` is DuckDB's own signed Parquet extension for DuckDB v1.4.3 (the engine
inside `@duckdb/duckdb-wasm` 1.32.0), downloaded unchanged from
`https://extensions.duckdb.org/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` on 10 November 2026.

- SHA-256: `22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55` (3,045,039 bytes).
- `scripts/build-spike.mjs` refuses to build if the file's hash differs, copies it to `public/spike/extensions/` and
  pins it into the vault worker; the worker checks the pin before DuckDB loads it, and DuckDB checks its signature.
- The app never lets DuckDB fetch extensions from DuckDB's servers (chunk 7F-2, Parquet in Import Studio).
- When `@duckdb/duckdb-wasm` is upgraded, replace this file with the matching version's `wasm_eh` build and update the
  hash here and in `scripts/build-spike.mjs`.
