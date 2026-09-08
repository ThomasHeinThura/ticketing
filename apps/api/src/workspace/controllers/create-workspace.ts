import { createId } from "@paralleldrive/cuid2";
import { DEFAULT_ROLE_NAMES, defaultRolePayloads } from "@taskdesk/permissions";
import { eq, like, or } from "drizzle-orm";
import db, { schema } from "../../database";
import { publishEvent } from "../../events";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import {
  nextAvailableSlug,
  randomSlugSuffix,
  slugifyWorkspaceName,
} from "../../utils/workspace-slug";

export type CreateWorkspaceInput = {
  name: string;
  slug?: string;
  logo?: string | null;
  description?: string | null;
  ownerId: string;
  /** The row id of the session making the call — effects 7 and 8. */
  sessionId: string;
};

export class WorkspaceSlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`Workspace slug "${slug}" is already taken`);
    this.name = "WorkspaceSlugTakenError";
  }
}

/**
 * How many times an AUTO-GENERATED slug is re-derived after losing the
 * unique-constraint race. An explicitly supplied slug is never retried —
 * that is the caller's 409 to receive.
 *
 * Attempt 0 takes the counted, readable slug (`acme-inc`, then `acme-inc-2`).
 * Every attempt after it takes a RANDOM suffix instead, because counting is
 * what made the losers of a race collide with each other a second time.
 */
const SLUG_RETRY_ATTEMPTS = 5;

async function proposeSlug(name: string): Promise<string> {
  const base = slugifyWorkspaceName(name);
  const neighbours = await db
    .select({ slug: schema.workspaceTable.slug })
    .from(schema.workspaceTable)
    .where(
      or(
        eq(schema.workspaceTable.slug, base),
        like(schema.workspaceTable.slug, `${base}-%`),
      ),
    );
  return nextAvailableSlug(
    base,
    neighbours.map((row) => row.slug),
  );
}

/**
 * Create a workspace and everything a workspace is not valid without.
 *
 * ONE TRANSACTION, and that is the point of this step. The inherited
 * `afterCreateOrganization` hook (`apps/api/src/auth.ts`) seeded the default
 * `workspace_role` rows AFTER the plugin had already committed the workspace,
 * inside a `try/catch` that logged the failure and continued — so a failed
 * seed left a fully successful workspace with no `viewer`/`member`/`admin`
 * rows behind it until the next process start ran the boot-time backfill.
 * That window is what issue #66 escalates through: with no row to match,
 * `hasWorkspacePermission` falls back to the compiled-in static role, so a
 * narrowed role silently regains its compiled privileges.
 *
 * Required authorization state does not get a best-effort path. Workspace,
 * owner membership, the three default role rows, the default team, its
 * team_member row and the creating session's active workspace/team either
 * COMMIT TOGETHER or ROLL BACK TOGETHER.
 *
 * `publishEvent` deliberately runs AFTER the commit: publishing inside the
 * transaction would announce — and, one hop later, persist a notification
 * about — a workspace a rollback then removed.
 *
 * The eight first-order effects of the create contract (retrofit plan §2.5)
 * are all here; effect 9, the `workspace_created` notification, follows from
 * the event and is eventual by design.
 */
async function createWorkspace(input: CreateWorkspaceInput) {
  const explicitSlug = typeof input.slug === "string" && input.slug.length > 0;

  for (let attempt = 0; ; attempt++) {
    let slug: string;
    if (explicitSlug) {
      slug = input.slug as string;
    } else if (attempt === 0) {
      slug = await proposeSlug(input.name);
    } else {
      slug = `${slugifyWorkspaceName(input.name)}-${randomSlugSuffix()}`;
    }

    try {
      const created = await db.transaction(async (tx) => {
        const now = new Date();

        // (1) the workspace row
        const [workspace] = await tx
          .insert(schema.workspaceTable)
          .values({
            name: input.name,
            slug,
            logo: input.logo ?? null,
            description: input.description ?? null,
            createdAt: now,
          })
          .returning();
        if (!workspace) {
          throw new Error("workspace insert returned no row");
        }

        // (2) the creator's owner membership
        await tx.insert(schema.workspaceUserTable).values({
          workspaceId: workspace.id,
          userId: input.ownerId,
          role: "owner",
          joinedAt: now,
        });

        // (3) the default role rows. `owner` is deliberately NOT among them
        // (retrofit plan R5): owner authority stays in the compiled-in
        // static role, and seeding an editable `owner` row would let an
        // admin edit the workspace creator's authority away.
        const seeded = await tx
          .insert(schema.workspaceRoleTable)
          .values(
            DEFAULT_ROLE_NAMES.map((role) => ({
              workspaceId: workspace.id,
              role,
              permission: JSON.stringify(defaultRolePayloads[role]),
              createdAt: now,
              updatedAt: now,
            })),
          )
          .returning({ role: schema.workspaceRoleTable.role });
        // A short insert is as dangerous as a failed one and does not throw
        // on its own, so it is checked rather than assumed.
        if (seeded.length !== DEFAULT_ROLE_NAMES.length) {
          throw new Error(
            `default role seed wrote ${seeded.length} of ${DEFAULT_ROLE_NAMES.length} rows`,
          );
        }

        // (5) the default team, named after the workspace, and (6) its
        // creator membership. Both tables' ids are plain text primary keys
        // with no database default — the plugin generated them.
        const [team] = await tx
          .insert(schema.teamTable)
          .values({
            id: createId(),
            name: workspace.name,
            workspaceId: workspace.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!team) {
          throw new Error("team insert returned no row");
        }

        await tx.insert(schema.teamMemberTable).values({
          id: createId(),
          teamId: team.id,
          userId: input.ownerId,
          createdAt: now,
        });

        // (7)+(8) the CREATING session selects the new workspace and team.
        // Preserved through S4–S7 by explicit decision (retrofit plan §2.5,
        // "Session selection is preserved through S4–S7"); dropping either
        // would leave a user who has just made their first workspace with
        // nothing selected and no error.
        await tx
          .update(schema.sessionTable)
          .set({
            activeOrganizationId: workspace.id,
            activeTeamId: team.id,
          })
          .where(eq(schema.sessionTable.id, input.sessionId));

        return { workspace, team };
      });

      // (4) the domain event, only ever on a committed workspace. Its three
      // fields ARE the contract: effect 9's notification row is built from
      // exactly these. The inherited call also passed an `ownerEmail` field
      // holding the user's NAME, which no consumer reads and which §2.5
      // rules out of the contract — it is not reproduced.
      await publishEvent("workspace.created", {
        workspaceId: created.workspace.id,
        workspaceName: created.workspace.name,
        ownerId: input.ownerId,
      });

      return created.workspace;
    } catch (error) {
      if (!isUniqueViolation(error, "slug")) {
        throw error;
      }
      // A caller-supplied slug that is taken is the caller's answer to give
      // back — 409, not a silently different slug.
      if (explicitSlug) {
        throw new WorkspaceSlugTakenError(slug);
      }
      // An auto-generated slug lost a race with a concurrent create. The
      // next attempt disperses rather than re-counting; see the constant.
      if (attempt >= SLUG_RETRY_ATTEMPTS) {
        throw error;
      }
    }
  }
}

export default createWorkspace;
