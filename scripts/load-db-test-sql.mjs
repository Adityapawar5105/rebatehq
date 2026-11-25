import { readFile } from 'node:fs/promises';

const marker = '-- INCLUDE FUNCTION ACL ALLOWLIST';
export async function loadDatabaseTestSql() {
  const [template, allowlist] = await Promise.all([
    readFile(new URL('../supabase/tests/phase1_rls.sql', import.meta.url), 'utf8'),
    readFile(new URL('../config/function-acl-allowlist.sql', import.meta.url), 'utf8'),
  ]);
  if (template.split(marker).length !== 2) throw new Error('Database suite must include the function ACL manifest exactly once.');
  if (!allowlist.trim()) throw new Error('Function ACL manifest must not be empty.');
  const chunk5b=await readFile(new URL('../supabase/tests/chunk5b_control.sql',import.meta.url),'utf8');
  const chunk7a=await readFile(new URL('../supabase/tests/chunk7a_relay.sql',import.meta.url),'utf8');
  const chunk8d=await readFile(new URL('../supabase/tests/chunk8d_bench.sql',import.meta.url),'utf8');
  const sharingS2=await readFile(new URL('../supabase/tests/sharing_s2.sql',import.meta.url),'utf8');
  const sharingS3=await readFile(new URL('../supabase/tests/sharing_s3.sql',import.meta.url),'utf8');
  const sharingS4=await readFile(new URL('../supabase/tests/sharing_s4.sql',import.meta.url),'utf8');
  return template.replace(marker, () => allowlist).replace('-- INCLUDE CHUNK 5B CHECKS',()=>chunk5b).replace('-- INCLUDE CHUNK 7A CHECKS',()=>chunk7a).replace('-- INCLUDE CHUNK 8D CHECKS',()=>chunk8d).replace('-- INCLUDE SHARING S2 CHECKS',()=>sharingS2).replace('-- INCLUDE SHARING S3 CHECKS',()=>sharingS3).replace('-- INCLUDE SHARING S4 CHECKS',()=>sharingS4);
}
