function canonicalRows(rows) {
  return [...rows]
    .map(row => ({ tenant_id: row.tenant_id, row_count: String(row.row_count) }))
    .sort((left, right) => {
      if (left.tenant_id === right.tenant_id) return 0;
      if (left.tenant_id === null) return -1;
      if (right.tenant_id === null) return 1;
      return left.tenant_id.localeCompare(right.tenant_id);
    });
}

export function diffTenantRowCounts(before, after) {
  const tableNames = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return tableNames.flatMap(tableName => {
    const beforeRows = Object.hasOwn(before, tableName) ? canonicalRows(before[tableName]) : null;
    const afterRows = Object.hasOwn(after, tableName) ? canonicalRows(after[tableName]) : null;
    return JSON.stringify(beforeRows) === JSON.stringify(afterRows)
      ? []
      : [{ tableName, before: beforeRows, after: afterRows }];
  });
}

export function assertTenantRowCountsEqual(before, after, context = "Tenant row counts changed") {
  const differences = diffTenantRowCounts(before, after);
  if (differences.length === 0) return;
  const details = differences.map(({ tableName, before: beforeRows, after: afterRows }) =>
    `public.${tableName}: before=${JSON.stringify(beforeRows)}, after=${JSON.stringify(afterRows)}`,
  );
  throw new Error(`${context}: ${details.join("; ")}`);
}
