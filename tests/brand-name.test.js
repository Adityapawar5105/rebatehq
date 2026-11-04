const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..');

// The product is RebateHQ. The old name may stay only where it is history or a deliberate legacy bridge.
const OLD_NAME = /margin-?desk/i;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'test-results', 'public', 'vault-evidence']);
const TEXT = /\.(md|ts|tsx|js|mjs|json|html|css|yml|yaml|toml|sql|txt|example)$/i;

// Whole files that legitimately mention the old name.
const LEGACY_FILES = new Set([
  'migrations.lock', 'schema.sql',
  'lib/vault/storage.ts', 'lib/vault/backup.ts', 'app.js',
  'scripts/check-schema.mjs',
  'tests/brand-name.test.js', 'tests/rename-app-role.test.js', 'tests/vault-legacy-storage.test.ts',
  'tests/browser/vault-worker.ts', 'tests/chunk2a-schema.test.js', 'tests/schema-migration-lint.test.js',
  'tests/restore-platform-acl.test.js', 'tests/rls-test-structure.test.js',
].map(file => file.replace(/\//g, path.sep)));
const LEGACY_PREFIXES = ['supabase/migrations/'].map(prefix => prefix.replace(/\//g, path.sep));
const EVIDENCE_FILE = /^(CHUNK_.*|.*VERIFICATION|.*RESULTS)\.md$/;
// Prose may cite past CI/restore runs (they ran under the old name) and explain the rename.
const PROSE_ALLOWED = /actions\/runs|\/commit\/|CI #|Drill #|margindesk_app|MarginDesk file imports|margindesk-vaults|margindesk-backup|margindesk\.ai|[Rr]enam|[Ll]egacy|MarginDesk to RebateHQ|MarginDesk -> RebateHQ/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name)); }
    else if (TEXT.test(entry.name)) yield path.join(dir, entry.name);
  }
}

test('the old product name does not reappear outside legacy bridges and past-evidence records', () => {
  const offenders = [];
  for (const file of walk(root)) {
    const rel = path.relative(root, file);
    if (LEGACY_FILES.has(rel) || LEGACY_PREFIXES.some(prefix => rel.startsWith(prefix)) || EVIDENCE_FILE.test(path.basename(rel))) continue;
    const prose = rel.endsWith('.md');
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      if (OLD_NAME.test(line) && !(prose && PROSE_ALLOWED.test(line))) offenders.push(`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], `The product is named RebateHQ. Remove the old name or, for a deliberate legacy bridge, add the file to LEGACY_FILES:\n${offenders.join('\n')}`);
});

test('the legacy allowlist only names files that exist', () => {
  for (const file of LEGACY_FILES) assert.ok(fs.existsSync(path.join(root, file)), `${file} no longer exists; remove it from LEGACY_FILES`);
});
