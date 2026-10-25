export type TenantRowCount = { tenant_id: string | null; row_count: string };
export type TenantRowSnapshot = Record<string, TenantRowCount[]>;
export type TenantRowCountDifference = {
  tableName: string;
  before: TenantRowCount[] | null;
  after: TenantRowCount[] | null;
};

export function diffTenantRowCounts(
  before: TenantRowSnapshot,
  after: TenantRowSnapshot,
): TenantRowCountDifference[];
export function assertTenantRowCountsEqual(
  before: TenantRowSnapshot,
  after: TenantRowSnapshot,
  context?: string,
): void;
