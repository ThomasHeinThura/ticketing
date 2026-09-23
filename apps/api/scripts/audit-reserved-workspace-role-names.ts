/**
 * Issue #318 (security), acceptance criterion 3: "Audit existing rows. Write a migration or
 * check that finds custom roles with built-in names in live data and reports them, and
 * decide how to handle them."
 *
 * REPORT-ONLY, BY DESIGN — not a migration, not wired into `runStartupTasks`
 * (`apps/api/src/index.ts`, which this lane does not touch). Three reasons:
 *
 * 1. **The runtime fix already closes every ESCALATION this could cause.**
 *    `require-workspace-capability.ts` and `resolve-identity.ts` now grant a
 *    `BUILT_IN_ROLES` name's capabilities only to a row backed by a genuine seeded
 *    `workspace_role` (`is_system = true`, or the name `"owner"`, which never gets a row at
 *    all). A pre-existing custom row that collided with a built-in name that is NEVER
 *    seeded (`manager`/`lead`/`customer`/`instance_admin`) already reads as an ordinary
 *    custom role, with only its own declared `permission` — that class ("name-collision"
 *    below) is genuinely benign now. **This is NOT true for `viewer`/`member`/`admin`** —
 *    migration `0068` backfills every existing row of those three names to `is_system =
 *    true` (and `seedDefaultWorkspaceRoles()` self-heals the same on every boot), so a row
 *    of one of those three names that STILL reads `is_system = false` after this PR is
 *    something this report calls out separately ("capability-loss-risk" below) precisely
 *    because it is not benign: that row is losing capabilities it should have.
 * 2. **Renaming or neutralising a row silently is explicitly out of scope.** The issue says
 *    "Don't delete or reassign anyone's role silently. If handling existing rows needs a
 *    product decision, stop and report the options" — a migration that renames rows would
 *    be exactly that silent reassignment, sight unseen, of however many workspaces happen
 *    to be affected. A member holding that role would see its name (and every reference to
 *    it: saved views, audit history, an API integration that names the role) change out
 *    from under them.
 * 3. **A row's own declared `permission` may be exactly what an administrator intended.**
 *    Nothing here proves a given `"manager"`-named row was created maliciously rather than
 *    by an administrator who simply liked that name before it was reserved — flagging it
 *    for human review is the fail-safe move; guessing a fix is not.
 *
 * Run manually: `pnpm --filter @taskdesk/api exec tsx scripts/audit-reserved-workspace-role-names.ts`
 * (or `node --import tsx scripts/audit-reserved-workspace-role-names.ts` from `apps/api/`).
 * Reads only — no write to the database. Exits 0 always; this is a report, not a gate.
 */
import {
  BUILT_IN_ROLE_KEYS,
  type BuiltInRoleKey,
  DEFAULT_ROLE_NAMES,
} from "@taskdesk/permissions";
import db, { schema } from "../src/database";

export type ReservedRoleNameViolationRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: string;
  readonly isSystem: boolean;
};

/**
 * Two DIFFERENT shapes of problem, and the report must never blur them (independent
 * Sonnet review of pull request #322, at head `8f8e9d6`, on the first version of this
 * file, which called every row here "naming hygiene, not a live escalation" — true for
 * `manager`/`lead`/`customer`/`instance_admin`, but WRONG for `viewer`/`member`/`admin`
 * before migration `0068` grew its backfill: on that version, every already-existing
 * `admin`/`member`/`viewer` row stayed `is_system = false` after deploy, and this report
 * would have called that capability-STRIPPING regression benign).
 *
 * - `"capability-loss-risk"` — `role` is one of `DEFAULT_ROLE_NAMES`
 *   (`viewer`/`member`/`admin`), the three names every workspace is SUPPOSED to have a
 *   genuine row for. `is_system = false` here means one of two things, and this report
 *   cannot tell which without more context: (a) this deployment ran migration `0068`
 *   before its backfill existed and `seedDefaultWorkspaceRoles()`'s own self-heal (same
 *   fix) has not run since — self-heals on the next boot, no action needed; or (b) a
 *   genuine historical collision predating the reserved-name check (see `0068`'s own
 *   comment for the disclosed, checked-against-`git log`, narrow window this could have
 *   happened in). Either way, THIS ROW IS RIGHT NOW NOT RECEIVING ITS BUILT-IN
 *   CAPABILITIES — an active regression for whoever holds it, not a hygiene item.
 * - `"name-collision"` — `role` is a reserved `BUILT_IN_ROLES` key that is NEVER seeded
 *   (`manager`, `lead`, `customer`, `instance_admin` — or `"owner"`, which is a data
 *   anomaly on its own: it never gets a row at all through any known write path). A row
 *   like this never legitimately held built-in capabilities, so `is_system = false` is
 *   the CORRECT, intended state — this is what the report calls naming hygiene: an
 *   administrator's custom role happens to be named the same as a reserved word, and no
 *   capability regression follows from it.
 */
export type ReservedRoleNameViolation = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: BuiltInRoleKey;
  readonly category: "capability-loss-risk" | "name-collision";
};

const RESERVED_NAMES: ReadonlySet<string> = new Set(BUILT_IN_ROLE_KEYS);
const DEFAULT_NAMES: ReadonlySet<string> = new Set(DEFAULT_ROLE_NAMES);

/**
 * The pure half — no I/O, exhaustively unit-testable without a database. A row is a
 * violation exactly when its `role` names a `BUILT_IN_ROLES` key AND `is_system` is not
 * `true` — a custom row (or a row from before this column existed, which defaults to
 * `false`) that merely shares a built-in's name. `"owner"` never gets a `workspace_role`
 * row at all (retrofit plan R5) and is reserved from custom creation regardless, so a row
 * literally named `"owner"` would itself be a data anomaly this same filter correctly
 * flags — it is not special-cased away here the way the two runtime resolvers special-case
 * it, because THIS check has no "no row" case to distinguish from "a row exists and is not
 * genuine": if a `workspace_role` row named `"owner"` exists at all, something already went
 * wrong.
 */
export function reservedRoleNameViolations(
  rows: readonly ReservedRoleNameViolationRow[],
): ReservedRoleNameViolation[] {
  const violations: ReservedRoleNameViolation[] = [];
  for (const row of rows) {
    // Strict `=== true`, matching `require-workspace-capability.ts`'s
    // `isGenuineBuiltInRoleAssignment` and the shared `isGenuineBuiltInRoleGrant`
    // (`workspace-member-roles.ts`) -- a row only ever clears this check by genuinely being
    // marked `true`, never by any other truthy value a malformed read might produce.
    if (row.isSystem === true) continue;
    if (!RESERVED_NAMES.has(row.role)) continue;
    violations.push({
      id: row.id,
      workspaceId: row.workspaceId,
      role: row.role as BuiltInRoleKey,
      category: DEFAULT_NAMES.has(row.role)
        ? "capability-loss-risk"
        : "name-collision",
    });
  }
  return violations;
}

async function main() {
  const rows = await db
    .select({
      id: schema.workspaceRoleTable.id,
      workspaceId: schema.workspaceRoleTable.workspaceId,
      role: schema.workspaceRoleTable.role,
      isSystem: schema.workspaceRoleTable.isSystem,
    })
    .from(schema.workspaceRoleTable);

  const violations = reservedRoleNameViolations(rows);

  if (violations.length === 0) {
    console.log(
      "audit-reserved-workspace-role-names: no custom workspace_role row collides with a built-in name.",
    );
    return;
  }

  const capabilityLossRisk = violations.filter(
    (v) => v.category === "capability-loss-risk",
  );
  const nameCollisions = violations.filter(
    (v) => v.category === "name-collision",
  );

  console.log(
    `audit-reserved-workspace-role-names: ${violations.length} workspace_role row(s) collide with a built-in name.`,
  );

  if (capabilityLossRisk.length > 0) {
    console.log(
      `\n${capabilityLossRisk.length} row(s) named viewer/member/admin are CURRENTLY NOT ` +
        "receiving their built-in capabilities -- an active regression, not a hygiene " +
        "item. If this deployment already ran migration 0068's own backfill (or has " +
        "rebooted since, which self-heals via seedDefaultWorkspaceRoles()), these should " +
        "not exist; their presence means something else planted a colliding row before " +
        "the reserved-name check existed. See 0068_workspace_role_is_system.sql's own " +
        "comment for the disclosed window this could happen in.",
    );
    console.table(
      capabilityLossRisk.map((v) => ({
        workspace_role_id: v.id,
        workspace_id: v.workspaceId,
        role: v.role,
      })),
    );
  }

  if (nameCollisions.length > 0) {
    console.log(
      `\n${nameCollisions.length} row(s) named manager/lead/customer/instance_admin (or ` +
        "the data anomaly 'owner') are naming hygiene only -- these rows never " +
        "legitimately held built-in capabilities, and require-workspace-capability.ts / " +
        "resolve-identity.ts correctly deny them now, same as before this report existed.",
    );
    console.table(
      nameCollisions.map((v) => ({
        workspace_role_id: v.id,
        workspace_id: v.workspaceId,
        role: v.role,
      })),
    );
  }
}

// Only run when invoked directly (`tsx scripts/audit-reserved-workspace-role-names.ts`),
// never when this module is imported for its exported pure function (its own unit test,
// e.g.).
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
