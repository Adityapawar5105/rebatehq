export type Role = "owner" | "manager" | "analyst" | "rep";
export type Permission =
  | "dashboard.read" | "products.read" | "costs.read" | "customers.read.all" | "customers.read.assigned"
  | "quotes.read.all" | "quotes.read.own" | "quotes.create" | "quotes.send" | "quotes.approve"
  | "files.review" | "prices.import" | "prices.edit" | "prices.publish" | "rebates.read" | "rebates.edit"
  | "policy.read" | "policy.edit" | "users.read" | "users.invite" | "users.role.change"
  | "audit.read" | "tenant.export" | "tenant.delete" | "prototype.import";

export const PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  owner: new Set(["files.review","dashboard.read","products.read","costs.read","customers.read.all","quotes.read.all","quotes.create","quotes.send","quotes.approve","prices.import","prices.edit","prices.publish","rebates.read","rebates.edit","policy.read","policy.edit","users.read","users.invite","users.role.change","audit.read","tenant.export","tenant.delete","prototype.import"]),
  manager: new Set(["files.review","dashboard.read","products.read","costs.read","customers.read.all","quotes.read.all","quotes.create","quotes.send","quotes.approve","prices.import","prices.edit","prices.publish","rebates.read","rebates.edit","policy.read","policy.edit","audit.read"]),
  analyst: new Set(["dashboard.read","products.read","costs.read","customers.read.all","quotes.read.all","quotes.create","quotes.send","prices.import","prices.edit","rebates.read","policy.read"]),
  rep: new Set(["dashboard.read","products.read","customers.read.assigned","quotes.read.own","quotes.create","quotes.send","policy.read"])
};

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS[role]?.has(permission) ?? false;
}
