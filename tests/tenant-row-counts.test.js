const assert = require("node:assert/strict");
const test = require("node:test");
const helpers = import("../scripts/tenant-row-counts.mjs");

test("tenant row-count snapshots compare equal independent of row ordering", async () => {
  const { assertTenantRowCountsEqual, diffTenantRowCounts } = await helpers;
  const before = {
    customer: [
      { tenant_id: "tenant-b", row_count: "3" },
      { tenant_id: null, row_count: "1" },
    ],
  };
  const after = {
    customer: [
      { tenant_id: null, row_count: 1 },
      { tenant_id: "tenant-b", row_count: 3 },
    ],
  };

  assert.deepEqual(diffTenantRowCounts(before, after), []);
  assert.doesNotThrow(() => assertTenantRowCountsEqual(before, after));
});

test("tenant row-count mismatch names the changed table and its counts", async () => {
  const { assertTenantRowCountsEqual } = await helpers;
  const before = { quote: [{ tenant_id: "tenant-a", row_count: "2" }] };
  const after = { quote: [{ tenant_id: "tenant-a", row_count: "3" }] };

  assert.throws(
    () => assertTenantRowCountsEqual(before, after, "Repeatability check failed"),
    /Repeatability check failed: public\.quote: before=.*"row_count":"2".*after=.*"row_count":"3"/,
  );
});

test("tenant row-count comparison reports missing or newly added tables", async () => {
  const { diffTenantRowCounts } = await helpers;
  const differences = diffTenantRowCounts({ customer: [] }, { quote: [] });
  assert.deepEqual(differences.map(difference => difference.tableName), ["customer", "quote"]);
});
