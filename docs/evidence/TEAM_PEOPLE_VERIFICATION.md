# Settings › Team and roles › People: verification

25 November 2026. Built by Claude Code from a reference design the user supplied (a user-management table), adapted to RebateHQ: one list of people, their RebateHQ role, workspace access, status, what they receive under the sharing grid, and actions. No schema change, no migration and no new request from the vault page.

## What changed

**One list of people.** `components/local/PeopleView.tsx` joins three sources, each kept where it belongs:
- **RebateHQ roles** from the encrypted vault (`roleList`, `roleSet`, `roleRemove`), enforced by the worker as before.
- **Members and open invitations** (sign-in email, workspace access, status, dates).
  - `app/home/page.tsx` reads them for a server role with `users.read`, the same rows `/account/users` shows.
  - It passes them to the vault as props (`lib/team.ts`), so the page makes no new request and the privacy gates are unchanged. In the lab there is no server, so the columns that need it are hidden.
- **What each person receives.** `roleList.sharing.receives` lists the built packs from the draft or signed grid; a lock badge marks "No cost".

**Layout:**
- **Header:** a count badge, **Workspace access**, and **Invite person** (Owner).
- **Toolbar:** search by name or email, then Role and Status filters.
- **Table:** a DataGrid (sort and filter on every column, "N of M rows"). Each row shows initials, name and email, role, workspace access, a status pill (Active, Suspended, Invited, On this device), receives, joined date and actions.

**Actions:**
- **Edit or Assign role.** It opens a dialog with the display name, the role and its summary. **Remove** returns a person to Sales Rep.
- **Toast and Undo.** A toast in the corner confirms each change, with **Undo**, and closes itself after 8 seconds.
- **Invitations** link to the account Users page (**Manage**). Workspace access, invitations and suspension stay on that page, which is now styled the same way.

**Rules carried into the page:**
- **Role conflicts.** The pairs the S2 signed-grid verifier refuses are caught when a role is chosen (`roleConflict`). An Owner needs Owner workspace access, and a publisher (Owner, Pricing Owner, the named Pricing Owner) needs Owner or Manager. The dialog explains and Save stays disabled.
- **Sharing on, grid Owner.** A role change is a draft; the notice and the toast say so ("Draft: … Signed at the next key rotation").
- **Sharing on, anyone else.** Roles follow the signed grid, so Edit and Remove are disabled and a notice explains why.
- **Role reference.** It moved into "What each role can do"; **Preview as** sits beside "You are …".

**Fixed in passing:** the account Users page's role select used the translated label as its value, so it could show the wrong role, and it showed the raw status text. It now uses the role id and a translated status pill.

## Checks run locally (not CI evidence)
- **Unit tests:** `tests/people.test.ts` (4 tests):
  - props mapping;
  - role-conflict rules;
  - `/home` reads only for `users.read`, and the page has no `fetch` or `/api/`;
  - `roleList.sharing`: a rep receives book prices and no cost pack, a Sales Manager receives cost, only built packs are listed, and a rep's vault gets no receive list.
- **Suites:** the full TypeScript suite (379) and JS suite (80) pass, including the i18n (every key used, en/es/fr, fr-CA "courriel") and theme-token checks.
- **In the browser (lab mode):**
  - adding people, the Edit dialog, Save, the toast, Undo, and the conflict warning with Save disabled;
  - the dark and light themes;
  - a temporary synthetic member list (not committed), to see the server columns: workspace access, Active, Suspended and Invited, Assign role and Manage.
- **Vault browser gate:** `scripts/test-vault-browser.mjs --browser=chrome` passed in lab mode against a local production build. It drives Settings › Team and roles and Preview as many times.
