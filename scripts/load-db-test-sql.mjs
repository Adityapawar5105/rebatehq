import { readFile } from 'node:fs/promises';

const marker = '-- INCLUDE FUNCTION ACL ALLOWLIST';
export async function loadDatabaseTestSql() {
  const [template, allowlist] = await Promise.all([
    readFile(new URL('../supabase/tests/phase1_rls.sql', import.meta.url), 'utf8'),
    readFile(new URL('../config/function-acl-allowlist.sql', import.meta.url), 'utf8'),
  ]);
  if (template.split(marker).length !== 2) throw new Error('Database suite must include the function ACL manifest exactly once.');
  if (!allowlist.trim()) throw new Error('Function ACL manifest must not be empty.');
  return template.replace(marker, () => allowlist);
}
