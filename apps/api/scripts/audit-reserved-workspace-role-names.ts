/**
 * Issue #318 (security), acceptance criterion 3: "Audit existing rows. Write a migration or
 * check that finds custom roles with built-in names in live data and reports them, and
 * decide how to handle them."
 *
 * REPORT-ONLY, BY DESIGN — not a migration, not wired into `runStartupTasks`
 * (`apps/api/src/index.ts`, which this lane does not touch). Three reasons:
 *
 * 1. **The runtime fix already neutralises every existing violation.**
 *    `require-workspace-capability.ts` and `resolve-identity.ts` now grant a
 *    `BUILT_IN_ROLES` name's capabilities only to a row backed by a genuine seeded
 *    `workspace_role` (`is_system = true`, or the name `"owner"`, which never gets a row at
 *    all). A pre-existing custom row that collided with a built-in name — the exact class
 *    this script finds — already reads as an ordinary custom role today, with only its own
 *    declared `permission`, not the built-in's capability set. There is no live escalation
 *    left for this script's report to close urgently; it exists so an operator can see and
 *    clean up the naming collision itself, not to gate a deploy on it.
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
import { BUILT_IN_ROLE_KEYS, type BuiltInRoleKey } from "@taskdesk/permissions";
import db, { schema } from "../src/database";

export type ReservedRoleNameViolationRow = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: string;
  readonly isSystem: boolean;
};

export type ReservedRoleNameViolation = {
  readonly id: string;
  readonly workspaceId: string;
  readonly role: BuiltInRoleKey;
};

const RESERVED_NAMES: ReadonlySet<string> = new Set(BUILT_IN_ROLE_KEYS);

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
    // `isGenuineBuiltInRoleAssignment` and `resolve-identity.ts`'s `isGenuineBuiltInRoleGrant`
    // -- a row only ever clears this check by genuinely being marked `true`, never by any
    // other truthy value a malformed read might produce.
    if (row.isSystem === true) continue;
    if (!RESERVED_NAMES.has(row.role)) continue;
    violations.push({
      id: row.id,
      workspaceId: row.workspaceId,
      role: row.role as BuiltInRoleKey,
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

  console.log(
    `audit-reserved-workspace-role-names: ${violations.length} custom workspace_role row(s) collide with a built-in name.`,
  );
  console.log(
    "These rows already grant only their own declared permission " +
      "(require-workspace-capability.ts / resolve-identity.ts deny built-in capabilities " +
      "to any row that is not genuinely seeded) -- this is a naming hygiene report, not a " +
      "live escalation.",
  );
  console.table(
    violations.map((v) => ({
      workspace_role_id: v.id,
      workspace_id: v.workspaceId,
      role: v.role,
    })),
  );
}

// Only run when invoked directly (`tsx scripts/audit-reserved-workspace-role-names.ts`),
// never when this module is imported for its exported pure function (its own unit test,
// e.g.).
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
