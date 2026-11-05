// Role assignments inside the vault. Rules enforced here (and tested in tests/roles.test.ts):
// a role is never self-assigned or self-removed, the last Owner and the named Pricing Owner
// cannot be demoted or removed, and only an Owner (or the named Pricing Owner) grants Owner or
// Pricing Owner. An unassigned person is a Sales Rep (least privilege), not an Owner.
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import type { Access, Person } from "../vault/protocol";
import { ROLE_LABEL, capsFor, intersect, isRole, sectionsFor, type RoleId } from "./access";
const rows = async (e: Engine, sql: string): Promise<Record<string, any>[]> => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)));
const bad = (text: string): never => { throw new VaultError("ROLES", text); };
export const cleanName = (value: string) => { if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\x00-\x1f]/.test(value)) return bad(msg("err.roles.useANameOf")); return value.trim(); };
export const cleanId = (value: string) => { if (typeof value !== "string" || !/^[A-Za-z0-9._:@+-]{1,160}$/.test(value)) return bad(msg("err.roles.useThePersonS")); return value; };
export async function repSeesCost(e: Engine) { return !!(await rows(e, "SELECT rep_sees_cost FROM access_settings WHERE id=1"))[0]?.rep_sees_cost; }
/** Compute what this signed-in person may do. `viewAs` can only remove capabilities, never add them. */
export async function accessFor(e: Engine, userId: string, viewAs: RoleId | null): Promise<Access> {
  const mine = (await rows(e, `SELECT role FROM role_assignments WHERE user_id=${Q(userId)}`))[0];
  const empty = Number((await rows(e, "SELECT count(*) AS n FROM role_assignments"))[0].n) === 0;
  const owner = (await rows(e, "SELECT owner_id FROM pricing_settings WHERE id=1"))[0]?.owner_id ?? null;
  // A vault that has no roles yet (created before roles existed) belongs to whoever unlocks it: they are its Owner.
  const role: RoleId = mine && isRole(mine.role) ? mine.role : empty ? "owner" : "sales_rep", assigned = !!mine || empty, seesCost = await repSeesCost(e);
  const named = owner !== null && owner === userId;
  let caps = capsFor(role, named, seesCost);
  if (viewAs && viewAs !== role) caps = intersect(caps, capsFor(viewAs, false, seesCost));
  const shown = viewAs ?? role;
  return { role: shown, roleLabel: named && !viewAs && role !== "pricing_owner" ? msg("role.withNamedOwner", { role: ROLE_LABEL[shown] }) : ROLE_LABEL[shown], assigned, viewAs, caps, sections: sectionsFor(caps), ownerNamed: owner !== null, repSeesCost: seesCost };
}
export async function people(e: Engine, userId: string): Promise<Person[]> {
  return (await rows(e, "SELECT user_id, display_name, role, assigned_at FROM role_assignments ORDER BY display_name, user_id LIMIT 500"))
    .map(r => ({ userId: String(r.user_id), name: String(r.display_name), role: r.role as RoleId, roleLabel: ROLE_LABEL[r.role as RoleId], assignedAt: String(r.assigned_at), you: r.user_id === userId }));
}
/** The first person in a vault becomes its Owner (idempotent). */
export function seedSql(userId: string, name: string, at: string) {
  return `INSERT INTO role_assignments SELECT ${Q(userId)}, ${Q(cleanName(name))}, 'owner', ${Q(userId)}, ${Q(at)} WHERE NOT EXISTS(SELECT 1 FROM role_assignments);`;
}
export async function setSql(e: Engine, actor: { userId: string; role: RoleId; namedOwner: boolean }, target: { userId: string; name: string; role: RoleId }, at: string) {
  const userId = cleanId(target.userId), name = cleanName(target.name);
  if (!isRole(target.role)) bad(msg("err.roles.chooseOneOfThe"));
  if (userId === actor.userId) bad(msg("err.roles.youCannotChangeYour"));
  const grants = target.role === "owner" || target.role === "pricing_owner";
  if (grants && actor.role !== "owner" && !actor.namedOwner) bad(msg("err.roles.onlyAnOwnerCan2"));
  const current = (await rows(e, `SELECT role FROM role_assignments WHERE user_id=${Q(userId)}`))[0];
  if (current && (current.role === "owner" || current.role === "pricing_owner") && actor.role !== "owner" && !actor.namedOwner) bad(msg("err.roles.onlyAnOwnerCan"));
  if (current?.role === "owner" && target.role !== "owner" && Number((await rows(e, "SELECT count(*) AS n FROM role_assignments WHERE role='owner'"))[0].n) <= 1) bad(msg("err.roles.aVaultNeedsAt2"));
  const named = (await rows(e, "SELECT owner_id FROM pricing_settings WHERE id=1"))[0]?.owner_id;
  if (named === userId && target.role === "sales_rep") bad(msg("err.roles.theNamedPricingOwner2"));
  return { userId, sql: `DELETE FROM role_assignments WHERE user_id=${Q(userId)}; INSERT INTO role_assignments VALUES(${Q(userId)},${Q(name)},${Q(target.role)},${Q(actor.userId)},${Q(at)});` };
}
export async function removeSql(e: Engine, actor: { userId: string }, userId: string) {
  userId = cleanId(userId);
  if (userId === actor.userId) bad(msg("err.roles.youCannotRemoveYour"));
  const current = (await rows(e, `SELECT role FROM role_assignments WHERE user_id=${Q(userId)}`))[0];
  if (!current) bad(msg("err.roles.thatPersonHasNo"));
  if ((await rows(e, "SELECT owner_id FROM pricing_settings WHERE id=1"))[0]?.owner_id === userId) bad(msg("err.roles.theNamedPricingOwner"));
  if (current.role === "owner" && Number((await rows(e, "SELECT count(*) AS n FROM role_assignments WHERE role='owner'"))[0].n) <= 1) bad(msg("err.roles.aVaultNeedsAt"));
  return `DELETE FROM role_assignments WHERE user_id=${Q(userId)};`;
}
export const accessSql = (repSeesCost: boolean) => `DELETE FROM access_settings WHERE id=1; INSERT INTO access_settings VALUES(1,${repSeesCost ? "true" : "false"});`;
