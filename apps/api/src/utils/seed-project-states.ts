import { and, eq, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import { DEFAULT_STATE_GROUP } from "./default-state-templates";

/** `state_template.group`'s own fixed ordering (ADR 0011), used only to give a freshly
 * seeded project's `state` rows a stable, readable `position` -- the columns a project
 * board renders in are otherwise arbitrary insert order. */
const GROUP_ORDER = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

/**
 * Seeds a freshly created project's concrete `state` rows from its workspace's
 * `state_template`s (issue #309, `projects-and-engagements.md` `PR-17`: "each project
 * owns its own concrete states ... seeded from the workspace's default templates on
 * creation"). Exactly one is marked `is_default` (`WI-4`), matching `state`'s own
 * partial unique index (`state_project_id_id_unique`'s sibling, "at most one default
 * `state` per project").
 *
 * Called from `create-project.ts`'s own transaction -- states commit or roll back
 * together with the project itself, the same atomicity `DEFAULT_PROJECT_COLUMNS`
 * already gets one table over.
 *
 * Idempotent via an existing-row check: `state` carries no `unique(project_id,
 * state_template_id)` today, so this guards with a plain "does this project already
 * have any state rows" read rather than a database constraint -- calling this twice for
 * the same project is a no-op the second time. Safe against a genuine create-time race
 * too: this is only ever invoked from inside `create-project.ts`'s transaction, itself
 * serialized per workspace by that function's own `pg_advisory_xact_lock`, so two calls
 * for the very same project id never actually run concurrently.
 */
export async function seedProjectStates(
  projectId: string,
  workspaceId: string,
  dbOrTx: Pick<typeof db, "select" | "insert"> = db,
): Promise<void> {
  const existing = await dbOrTx
    .select({ id: schema.stateTable.id })
    .from(schema.stateTable)
    .where(eq(schema.stateTable.projectId, projectId))
    .limit(1);
  if (existing.length > 0) {
    return;
  }

  const templates = await dbOrTx
    .select()
    .from(schema.stateTemplateTable)
    .where(
      and(
        eq(schema.stateTemplateTable.workspaceId, workspaceId),
        isNull(schema.stateTemplateTable.archivedAt),
      ),
    );
  if (templates.length === 0) {
    // Nothing to adopt yet -- a workspace with no templates at all (should not happen
    // once `seedWorkspaceDefaults` has run, but this function makes no assumption about
    // when it is called relative to that one). Leaving the project with zero states is
    // safer than guessing a template into existence.
    return;
  }

  const ordered = [...templates].sort((a, b) => {
    const groupDelta =
      GROUP_ORDER.indexOf(a.group as (typeof GROUP_ORDER)[number]) -
      GROUP_ORDER.indexOf(b.group as (typeof GROUP_ORDER)[number]);
    return groupDelta !== 0 ? groupDelta : a.key.localeCompare(b.key);
  });

  const defaultTemplate =
    ordered.find((template) => template.group === DEFAULT_STATE_GROUP) ??
    ordered[0];

  await dbOrTx.insert(schema.stateTable).values(
    ordered.map((template, index) => ({
      projectId,
      stateTemplateId: template.id,
      position: index,
      isDefault: template.id === defaultTemplate?.id,
    })),
  );
}

export default seedProjectStates;
