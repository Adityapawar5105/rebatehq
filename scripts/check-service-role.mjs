import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["app", "components", "lib", "legacy"];
const sourceRoots = ["app", "components", "lib"];
const sourceFiles = ["proxy.ts", "next.config.ts", "index.html", "app.js", "seed.js", "margin-engine.js", "margin-engine.d.ts"];
const forbidden = /service[_-]?role(?:[_-]?key)?/i;
const files = [...sourceFiles.map(file => path.join(root, file))];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) files.push(file);
  }
}
for (const directory of sourceRoots) walk(path.join(root, directory));
const hits = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (forbidden.test(source)) hits.push(path.relative(root, file));
}
if (hits.length) {
  process.stderr.write(`Forbidden service-role credential reference in user-facing source:\n${hits.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Service-role source scan passed (${files.length} user-facing files checked).\n`);
