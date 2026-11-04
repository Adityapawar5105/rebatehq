import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

// All application functions participate in grant preservation. Only the two
// functions implicated in Drill #9 are printed at every diagnostic checkpoint.
export const FUNCTION_ACL_SQL = `
  SELECT p.proname::text AS function_name,
         format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS signature,
         pg_get_userbyid(p.proowner)::text AS owner,
         pg_get_userbyid(a.grantor)::text AS grantor,
         CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END AS grantee,
         a.privilege_type, a.is_grantable
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a ON true
  WHERE n.nspname='public' AND p.prokind='f'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
  ORDER BY signature,grantee,grantor,a.privilege_type,a.is_grantable
`;

export function assertAppGrantsPreserved(before, after, fromStage, toStage) {
  const appRows = rows => rows.filter(row => row.grantee === "rebatehq_app")
    .map(row => JSON.stringify(row)).sort();
  const previous = appRows(before), current = appRows(after);
  assert.ok(previous.length > 0, `${fromStage}: no rebatehq_app function ACLs captured; refusing a vacuous comparison.`);
  const removed = previous.filter(row => !current.includes(row));
  const added = current.filter(row => !previous.includes(row));
  assert.ok(!removed.length && !added.length,
    `rebatehq_app function ACLs changed at ${fromStage} -> ${toStage}:\n` +
    JSON.stringify({ removed: removed.map(JSON.parse), added: added.map(JSON.parse) }, null, 2));
}

export function formatRestoreStepOrder(workflow) {
  const steps = [...workflow.matchAll(/^      - name: (.+)\r?\n([\s\S]*?)(?=^      - |$(?![\s\S]))/gm)];
  assert.ok(steps.length > 0, "No named restore workflow steps found.");
  return ["Configured restore execution order (local/hosted alternatives show their conditions):",
    ...steps.map((match,index) => {
      const condition = match[2].match(/^        if: (.+)$/m)?.[1]?.trim();
      return `${index+1}. ${match[1].trim()}${condition ? ` [if: ${condition}]` : ""}`;
    })].join("\n");
}

async function main() {
  if (process.argv[2] === "--order") {
    const order = formatRestoreStepOrder(await readFile(process.argv[3], "utf8"));
    process.stdout.write(`${order}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Restore procedure\n\n\`\`\`text\n${order}\n\`\`\`\n`);
    return;
  }
  const stage = process.argv[2], directory = process.argv[3];
  const stages = ["source","after-schema","after-cleanup","after-data"];
  assert.ok(stages.includes(stage) && directory, "Usage: inspect-restore-function-acls.mjs <source|after-schema|after-cleanup|after-data> <evidence-directory>");
  const connectionString = stage === "source" ? process.env.RESTORE_TEST_SOURCE_DATABASE_URL : process.env.RESTORE_TEST_TARGET_DATABASE_URL;
  assert.ok(connectionString, `Missing ${stage === "source" ? "RESTORE_TEST_SOURCE_DATABASE_URL" : "RESTORE_TEST_TARGET_DATABASE_URL"}.`);
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const rows = (await client.query(FUNCTION_ACL_SQL)).rows;
    const focus = rows.filter(row => ["convert_quantity","record_data_quality_issue"].includes(row.function_name));
    assert.equal(new Set(focus.map(row => row.function_name)).size, 2, `${stage}: both Chunk 2A functions must exist.`);
    const output = `Function ACL checkpoint: ${stage}\n${JSON.stringify(focus,null,2)}`;
    process.stdout.write(`${output}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Function ACL checkpoint: ${stage}\n\n\`\`\`json\n${JSON.stringify(focus,null,2)}\n\`\`\`\n`);
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,`${stage}.json`),JSON.stringify(rows,null,2));
    if (stage !== "source") {
      const previousStage = stages[stages.indexOf(stage)-1];
      const previous = JSON.parse(await readFile(path.join(directory,`${previousStage}.json`),"utf8"));
      assertAppGrantsPreserved(previous, rows, previousStage, stage);
      process.stdout.write(`PASS: every rebatehq_app function ACL is preserved from ${previousStage} to ${stage}.\n`);
    }
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof assert.AssertionError ? error.message : `Restore ACL diagnostic failed (${error.code || error.name || "unknown error"}).`);
    process.exitCode = 1;
  });
}
