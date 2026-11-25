"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { RoleList } from "@/lib/vault/protocol";
import type { TeamDirectory } from "@/lib/team";
import { ROLES, type RoleId } from "@/lib/roles/access";
import { msg, say, t } from "@/lib/i18n";
import styles from "./vault.module.css";
import p from "./people.module.css";
import { PeopleView } from "./PeopleView";
/** Team roles. The worker enforces them: a role without cost access never receives cost values.
 *  The people list (25 Nov 2026) joins these roles with the workspace's members and invitations (`team`, from the server). */
export function RolesView({ client, busy, operation, refresh, team = null, children }: { client: VaultClient; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; team?: TeamDirectory | null; /** 8.5: the sharing set-up line sits inside this card. */ children?: ReactNode }) {
  const [list, setList] = useState<RoleList | null>(null), [note, setNote] = useState("");
  useEffect(() => { let on = true; void client.call("roleList", {}).then(l => { if (on) setList(l); }).catch(() => { if (on) setNote(msg("roles.couldNotLoadRoles")); }); return () => { on = false; }; }, [client]);
  if (!list) return <section className={styles.card} aria-busy="true"><h2>{t("roles.teamAndRoles2")}</h2><p role="status">{say(note) || t("roles.loadingRoles")}</p></section>;
  const preview = (role: string) => void operation(async () => { setList(await client.call("rolePreview", { role: (role || null) as RoleId | null })); setNote(msg(role ? "roles.previewingThatRole" : "roles.backToYourOwn")); await refresh(); });
  return <section className={styles.card} aria-labelledby="roles-heading" data-testid="roles">
    <h2 id="roles-heading">{t("roles.teamAndRoles")}</h2>
    <div className={p.youLine}>
      <p>{t("roles.youAre")}{" "}<strong>{say(list.you.roleLabel)}</strong>{t("roles.sentenceEnd")} {list.pricingOwner ? t("roles.pricingOwner", { pricingOwner: list.pricingOwner }) : t("roles.noPricingOwnerIs")}</p>
      <label className={p.preview} title={t("roles.seeTheAppAs")}>{t("roles.previewAs")}
        <select value={list.you.viewAs ?? ""} disabled={busy} onChange={e => preview(e.target.value)}><option value="">{t("roles.myOwnRole")}</option>{ROLES.map(r => <option key={r.id} value={r.id}>{say(r.label)}</option>)}</select></label>
    </div>
    <p className={styles.muted}>{t("roles.rolesAreStoredIn")}</p>
    <p role="status">{say(note)}</p>
    {list.canManage ? <PeopleView client={client} busy={busy} list={list} team={team} onList={setList} refresh={refresh} operation={operation}/>
      : <p className={styles.muted}>{t("roles.onlyAnOwnerOr")}</p>}
    <p className={styles.muted} data-testid="reps-never-see-cost">{t("roles.repsNeverSeeCost")}</p>
    <details className={p.guide}>
      <summary>{t("people.roleGuide")}</summary>
      <div className={styles.tableWrap}><table className={styles.table} aria-label={t("roles.roles")}><thead><tr><th scope="col">{t("roles.role3")}</th><th scope="col">{t("roles.whatItCanDo")}</th></tr></thead><tbody>{ROLES.map(r => <tr key={r.id}><td>{say(r.label)}</td><td className={styles.wrap}>{say(r.summary)}</td></tr>)}</tbody></table></div>
    </details>
    {children}
  </section>;
}
