import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// These are the conventional browser-facing directories. Missing optional
// directories are reported, then skipped so a clean checkout stays scannable.
const sourceDirectories = ["app", "components", "lib", "src", "pages", "public"];
const rootClientFiles = [
  "proxy.ts",
  "next.config.ts",
  "seed.js",
  "margin-engine.js",
  "margin-engine.d.ts",
];
const sourceExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css", ".json", ".svg", ".webmanifest", ".txt", ".map",
]);
const forbidden = /service[_-]?role(?:[_-]?key)?/i;

export function collectUserFacingFiles(root = defaultRoot, warn = message => process.stderr.write(`${message}\n`)) {
  const files = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
    }
  }

  for (const relativeDirectory of sourceDirectories) {
    const directory = path.join(root, relativeDirectory);
    if (!fs.existsSync(directory)) {
      warn(`Warning: user-facing source directory is missing and was skipped: ${relativeDirectory}`);
      continue;
    }
    if (!fs.statSync(directory).isDirectory()) {
      warn(`Warning: configured user-facing source path is not a directory and was skipped: ${relativeDirectory}`);
      continue;
    }
    walk(directory);
  }

  for (const relativeFile of rootClientFiles) {
    const file = path.join(root, relativeFile);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) files.push(file);
  }

  return files;
}

export function findServiceRoleReferences(files) {
  const hits = [];
  for (const file of files) {
    if (forbidden.test(fs.readFileSync(file, "utf8"))) hits.push(file);
  }
  return hits;
}

export function checkUserFacingSources(root = defaultRoot, warn) {
  const files = collectUserFacingFiles(root, warn);
  if (files.length === 0) {
    throw new Error("Service-role source scan found zero user-facing files; refusing to pass an empty scan.");
  }

  const hits = findServiceRoleReferences(files);
  if (hits.length) {
    const relativeHits = hits.map(file => path.relative(root, file));
    throw new Error(`Forbidden service-role credential reference in user-facing source:\n${relativeHits.join("\n")}`);
  }

  return files.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const count = checkUserFacingSources();
    process.stdout.write(`Service-role source scan passed (${count} user-facing files checked).\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
