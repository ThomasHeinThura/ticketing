import { randomUUID } from "node:crypto";
import {
  DEFAULT_ROLE_NAMES,
  type DefaultRoleName,
  defaultRolePayloads,
} from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { DEFAULT_PROJECT_COLUMNS } from "../../../apps/api/src/project/controllers/create-project";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../../apps/api/src/utils/seed-internal-organisation";

export type SeededMemberContext = {
  user: typeof schema.userTable.$inferSelect;
  workspace: typeof schema.workspaceTable.$inferSelect;
};

/**
 * Give an authenticated integration-test caller the initialized-instance and active
 * staff-identity context expected by agent API middleware. This deliberately does not
 * repair an existing singleton row or an existing inactive/missing person: tests for
 * bootstrap and identity-denial behavior must construct those states explicitly.
 */
export async function prepareAuthenticatedApiFixture(userId: string) {
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing({ target: schema.instanceSettingTable.id });
  await ensureStaffPersonForUser(userId);
}

/**
 * `drizzle-orm`'s `.returning()` types as `T[]`, and `noUncheckedIndexedAccess` makes
 * `rows[0]` (and array destructuring, which is sugar for the same index access) `T |
 * undefined`. In a seeded integration test that row is always expected to exist — its
 * absence means the insert itself failed — so this throws a clear, attributable error
 * instead of letting every caller re-derive the same "possibly undefined" narrowing, or
 * silently propagate `| undefined` into a type that does not expect it.
 *
 * Accepts `readonly (T | undefined)[]`, not `readonly T[]`: a caller that destructures
 * first (`const [backlog] = await db.insert(...).returning()`) hands this an array whose
 * element type is already `Row | undefined` (`noUncheckedIndexedAccess` on the
 * destructure), and inferring `T` from a `T[]` parameter against that array would infer
 * `T = Row | undefined` right back, defeating the narrowing this function exists to do.
 */
export function requireRow<T>(
  rows: readonly (T | undefined)[],
  context: string,
): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${context}: insert returned no row`);
  }
  return row;
}

function isDefaultRoleName(role: string): role is DefaultRoleName {
  return (DEFAULT_ROLE_NAMES as readonly string[]).includes(role);
}

export async function createWorkspaceMember(
  overrides?: Partial<{
    userName: string;
    workspaceName: string;
    role: string;
    /**
     * Whether to seed a `workspace_role` row for `role` when it names one
     * of the three default roles (viewer/member/admin) -- mirroring what
     * every real creation path now guarantees (issue #66: the native
     * create transaction and the plugin's `afterCreateOrganization` hook
     * both seed these unconditionally). Defaults to `true` so ordinary
     * RBAC fixtures reflect that guarantee rather than relying on the
     * fail-open fallback #66 removed. Set to `false` to deliberately
     * reproduce a missing-row condition.
     */
    seedDefaultRoleRow: boolean;
  }>,
): Promise<SeededMemberContext> {
  const userId = `user-${randomUUID()}`;
  const workspaceId = `workspace-${randomUUID()}`;
  const role = overrides?.role ?? "member";

  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: overrides?.userName || "Integration Test User",
      })
      .returning(),
    "createWorkspaceMember: user",
  );

  // Authenticated fixture users model an already-claimed instance and an ordinary
  // active staff identity. Bootstrap/empty-instance tests build their own users and
  // singleton rows so their negative cases stay meaningful.
  await prepareAuthenticatedApiFixture(user.id);

  // #192: `workspace.organisation_id` is NOT NULL -- `resetTestDatabase` only truncates,
  // it does not reseed, so the internal organisation is genuinely absent after a reset and
  // this is a real create-on-first-use, not a lookup. Calling the same idempotent
  // get-or-create the app itself uses is correct in both cases regardless.
  const organisation = await ensureInternalOrganisation();

  const workspace = requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        id: workspaceId,
        createdAt: new Date(),
        name: overrides?.workspaceName || "Integration Test Workspace",
        slug: `workspace-${randomUUID()}`,
        organisationId: organisation.id,
      })
      .returning(),
    "createWorkspaceMember: workspace",
  );

  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });

  if ((overrides?.seedDefaultRoleRow ?? true) && isDefaultRoleName(role)) {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: workspace.id,
      role,
      permission: JSON.stringify(defaultRolePayloads[role]),
      // Issue #318 (security): mirrors what every real creation path now guarantees
      // (`seed-default-workspace-roles.ts`, `create-workspace.ts`) -- a genuine row, not a
      // custom one, so `require-workspace-capability.ts` and `resolveIdentity` grant this
      // built-in's capabilities the same way they would for a real seeded workspace.
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { user, workspace };
}

export async function createProjectFixture({
  workspaceId,
  name = "Integration Project",
  icon = "Folder",
  slug = `project-${randomUUID()}`,
}: {
  workspaceId: string;
  name?: string;
  icon?: string;
  slug?: string;
}) {
  const project = requireRow(
    await db
      .insert(schema.projectTable)
      .values({
        workspaceId,
        name,
        icon,
        slug,
      })
      .returning(),
    "createProjectFixture: project",
  );

  const insertedColumns: (typeof schema.columnTable.$inferSelect)[] = [];

  for (const col of DEFAULT_PROJECT_COLUMNS) {
    const [inserted] = await db
      .insert(schema.columnTable)
      .values({
        projectId: project.id,
        name: col.name,
        slug: col.slug,
        position: col.position,
        isFinal: col.isFinal,
      })
      .returning();
    if (inserted) {
      insertedColumns.push(inserted);
    }
  }

  const columnsBySlug = new Map(
    insertedColumns.map((column) => [column.slug, column]),
  );

  const todo = columnsBySlug.get("to-do");
  const inProgress = columnsBySlug.get("in-progress");
  const inReview = columnsBySlug.get("in-review");
  const done = columnsBySlug.get("done");

  if (!todo || !inProgress || !inReview || !done) {
    throw new Error("Failed to seed default project columns");
  }

  return {
    project,
    columns: {
      todo,
      inProgress,
      inReview,
      done,
    },
  };
}

/**
 * Give a test actor explicit, persisted project authority. Workspace membership or
 * workspace role alone is deliberately insufficient for project-scoped reads.
 */
export async function grantProjectRole(
  userId: string,
  projectId: string,
  capabilities: readonly string[],
) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!person)
    throw new Error("grantProjectRole: active person was not provisioned");

  const [project] = await db
    .select({ workspaceId: schema.projectTable.workspaceId })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
  if (!project)
    throw new Error("grantProjectRole: project was not provisioned");

  const [role] = await db
    .insert(schema.roleTable)
    .values({
      scope: "project",
      workspaceId: project.workspaceId,
      key: `project-fixture-${randomUUID()}`,
      name: "Integration project role",
      rank: 1,
      capabilities: [...capabilities],
    })
    .returning();
  if (!role) throw new Error("grantProjectRole: role insert returned no row");

  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId: role.id,
    seesAll: false,
  });
  return role;
}
