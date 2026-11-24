// Team sharing (SHARING_DESIGN.md section 3; blueprint section 22, item 38): every data pack, whether it carries cost,
// and the default sharing grid. One list for the vault worker, the relay protocol and the server, so the cost lock
// (decision D18) is decided in one place. It imports nothing, so the server route never reaches vault code; the role list
// and the roles with cost are copies that tests/relay-sharing.test.ts proves equal to ROLE_IDS and capsFor.

/** All packs in the design. S1 builds the first seven; the rest arrive with later releases. Order is canonical. */
export const ALL_PACKS = ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors", "supplier", "rules", "competitors", "documents", "results"] as const;
export type AnyPack = typeof ALL_PACKS[number];
/** Packs that contain cost or something cost can be worked out from. */
export const COST_PACKS: readonly AnyPack[] = ["cost", "cost_floors", "supplier", "rules", "competitors", "results"];
export const isPack = (v: unknown): v is AnyPack => typeof v === "string" && (ALL_PACKS as readonly string[]).includes(v);
export const VAULT_ROLES = ["owner", "pricing_owner", "pricing_manager", "sales_manager", "sales_rep", "accountant", "admin"] as const;
export type RoleId = typeof VAULT_ROLES[number];
/** Roles with the cost capability. A role can hold a cost pack only with it (Sales Rep and Admin / IT never). */
export const COST_ROLES: readonly RoleId[] = ["owner", "pricing_owner", "pricing_manager", "sales_manager", "accountant"];
export const costRole = (role: RoleId) => COST_ROLES.includes(role);
/** Publishers: the Owner, the Pricing Owner and the named Pricing Owner. They receive every pack and may sign keys. */
export const publisherRole = (role: RoleId, named: boolean) => named || role === "owner" || role === "pricing_owner";
/** The "Recommended" starting ticks (SHARING_DESIGN.md section 3.2). Locked cells are never listed. */
export const RECOMMENDED: Record<RoleId, readonly AnyPack[]> = {
  owner: ALL_PACKS,
  pricing_owner: ALL_PACKS,
  pricing_manager: ALL_PACKS,
  sales_manager: ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors", "documents", "results"],
  sales_rep: ["items", "customers", "book", "contracts", "guards", "documents"],
  accountant: ["items", "customers", "book", "contracts", "cost", "supplier", "results"],
  admin: ["items", "book"],
};
/** Packs one person receives: their role's ticks plus their own extras, never a cost pack without cost; publishers get all. */
export function packsFor(role: RoleId, named: boolean, ticks: Partial<Record<RoleId, readonly AnyPack[]>>, extras: readonly AnyPack[] = []): AnyPack[] {
  if (publisherRole(role, named)) return [...ALL_PACKS];
  const wanted = new Set<AnyPack>([...(ticks[role] ?? []), ...extras]);
  return ALL_PACKS.filter(p => wanted.has(p) && (costRole(role) || !COST_PACKS.includes(p)));
}
