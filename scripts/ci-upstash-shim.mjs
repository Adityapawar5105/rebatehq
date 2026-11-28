// CI only (review R3, CI #301): the app's limiter (@upstash/ratelimit) sends Lua scripts that start with
// `#!lua flags=allow-key-locking`, a flag only Upstash's hosted Redis accepts; open-source Redis refuses the script, so
// the Upstash-compatible endpoint CI runs (serverless-redis-http in front of a real Redis) answered every limit check
// with an error. This pass-through removes that one shebang line from EVAL scripts and forwards everything else, headers
// and bodies, unchanged. Counting still happens in the real Redis. EVALSHA of the original script then misses
// (NOSCRIPT) and the client falls back to EVAL, as it is written to.
import http from 'node:http';

const listen = new URL(process.env.SHIM_LISTEN ?? 'http://127.0.0.1:8078');
const target = new URL(process.env.SHIM_TARGET ?? 'http://127.0.0.1:8079');
for (const u of [listen, target]) if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('The CI limiter shim runs on this machine only');
const SHEBANG = /^#!lua[^\n]*\n/;

function rewrite(command) {
  if (Array.isArray(command) && typeof command[0] === 'string' && command[0].toLowerCase() === 'eval' && typeof command[1] === 'string')
    return [command[0], command[1].replace(SHEBANG, ''), ...command.slice(2)];
  return command;
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    let body = Buffer.concat(chunks).toString('utf8');
    try {
      const parsed = JSON.parse(body);
      // A single command is an array of strings; a pipeline is an array of commands.
      body = JSON.stringify(Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed.map(rewrite) : rewrite(parsed));
    } catch { /* not JSON: forward as is */ }
    try {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length', 'connection'].includes(k)));
      const answer = await fetch(new URL(req.url ?? '/', target), { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : body });
      const out = Buffer.from(await answer.arrayBuffer());
      const back = {};
      answer.headers.forEach((v, k) => { if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k)) back[k] = v; });
      res.writeHead(answer.status, back).end(out);
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'shim: ' + (error instanceof Error ? error.message : 'forward failed') }));
    }
  });
}).listen(Number(listen.port), listen.hostname, () => console.log(`CI limiter shim on ${listen.origin} → ${target.origin}`));
