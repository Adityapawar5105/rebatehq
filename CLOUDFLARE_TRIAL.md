# Cloudflare Workers trial — feasibility report

Written by Claude Code on 26 November 2026, at the user's request, after team sharing S5. **It is a desk study, not a deployment.** Nothing was installed, built or deployed for Cloudflare, for two reasons:
- this machine has no package manager, and installing `@opennextjs/cloudflare` or `wrangler` means downloading new packages;
- creating a Cloudflare account or project, and deploying, need the owner.

Staging stays on Netlify (`NETLIFY_DEPLOYMENT.md`).

## What the app needs from a host

- **Pages and routes:** Next.js 16.4 App Router pages and route handlers (sign-in, callbacks, `/api/licence`, `/api/relay`, `/api/licence/devices`, benchmarks). They run on the Node.js runtime.
- **`proxy.ts`:** the Next 16 name for middleware. It runs on Node.js by default and cannot be switched to Edge. It holds the nonce CSP, the CSRF origin check and the Supabase session refresh, and uses `node:crypto` `randomBytes`.
- **Database:** `pg` (node-postgres) with a pool kept on `globalThis` (`lib/db.ts`), TLS with `rejectUnauthorized`, and `node:net` `isIP`. On Netlify the Supabase root CA travels as an included file (`certs/supabase-root-ca.crt`).
- **`node:crypto` elsewhere:** licence signing and verification, request identity and audit, in eight server files.
- **Static files:** the prebuilt vault worker and DuckDB-Wasm assets under `/spike/*`. They need `Cross-Origin-Resource-Policy`, `Cross-Origin-Embedder-Policy` and `nosniff` headers (`netlify.toml`).
- **Size:** the server output is about 5 MB before bundling for a Worker.

## What Cloudflare offers (sources below)

- **Two ways to run Next.js:**
  - **OpenNext** (`@opennextjs/cloudflare`) is the established route;
  - **vinext,** which Cloudflare now recommends for new Next.js apps on Workers. Its support table lists `middleware.ts` and `proxy.ts`.
- **Node.js middleware on OpenNext:** Cloudflare's OpenNext page lists the Node.js middleware introduced in Next 15.2 as not yet supported.
  - Community reports say OpenNext does not pick up `proxy.ts`, and keep the Edge `middleware.ts` name instead.
  - Next 16 locks `proxy.ts` to Node.js.
- **Postgres from Workers:** possible over outbound TCP (`cloudflare:sockets`) with the `nodejs_compat` flags. The Hyperdrive docs list `nodejs_compat_v2` and `pg` newer than 8.16.3 for node-postgres. **Sockets cannot be created in global scope and shared across requests.**
- **No local files at run time:** a Worker cannot read the CA file. The certificate has to be bundled as a module, or Hyperdrive used.

## What would have to change

1. **Middleware.**
   - **On OpenNext:** rename `proxy.ts` back to `middleware.ts` on the Edge runtime. Replace `node:crypto` `randomBytes` with `crypto.getRandomValues`, and confirm `@supabase/ssr` works there.
   - **On vinext:** keep `proxy.ts`, if its support claim holds for our use.
   - Either way the CSP nonce and the CSRF check must keep their exact behaviour; the authenticated privacy gate covers both.
2. **Database (`lib/db.ts`):** no pool on `globalThis`; open one client per request inside the handler, or use Hyperdrive in front of Supabase. Bundle the Supabase CA, or let Hyperdrive handle TLS. Check that `node:net` `isIP` is available under `nodejs_compat`.
3. **Headers for `/spike/*`:** move them from `netlify.toml` to the Worker's static-asset headers (a `_headers` file or the adapter's config).
4. **Size:** check the bundled Worker against the plan's script size limit; it was not confirmed in this study.
5. **CI:** a separate job would build the Worker and run the authenticated privacy, vault and relay gates against `wrangler dev`, before any deployment.

## Recommendation

- **Do not move hosts now.** Netlify already runs the app, its OpenNext adapter supports `proxy.ts` on Node.js, and staging passes the hosted pgTAP suite.
- **Moving to Cloudflare means work in middleware and database code** that every privacy and security gate depends on, and it would need its own verification chunk.
- **If cost or latency makes Cloudflare worth it,** try **vinext** first (it lists `proxy.ts`) on a throwaway branch, after the owner:
  - creates a Cloudflare account;
  - approves installing `vinext`/`wrangler` with pnpm.
- **Fallback:** OpenNext with `middleware.ts`.
- **Vercel** remains the other option named in the plan. It runs `proxy.ts` natively, and would need only environment and header configuration.

## Sources

- Cloudflare, *OpenNext* framework guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- OpenNext for Cloudflare: https://opennext.js.org/cloudflare
- Cloudflare, *Next.js on Pages / vinext support table*: https://developers.cloudflare.com/pages/framework-guides/nextjs/ssr/
- Cloudflare blog, *vinext 1.0*: https://blog.cloudflare.com/vinext-nextjs-on-vite/
- Next.js, *Next.js across platforms (Adapter API)*: https://nextjs.org/nextjs-across-platforms
- Next.js, *proxy.ts* file convention: https://nextjs.org/docs/pages/api-reference/file-conventions/proxy
- Community note on `proxy.ts` and OpenNext: https://tessl.io/registry/skills/github/secondsky/claude-skills/cloudflare-nextjs
- Cloudflare, *Connect to PostgreSQL (Hyperdrive)*: https://developers.cloudflare.com/hyperdrive/configuration/connect-to-postgres
- Cloudflare, *TCP sockets*: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
