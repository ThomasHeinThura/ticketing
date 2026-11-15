import { reaches } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { currentProjectReachPredicate } from "../../apps/api/src/database/repositories/identity-scope.repository";
import { projectReachPredicate } from "../../apps/api/src/notification/task-reach.repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

describe("reserved custom workspace role reach parity", () => {
  beforeEach(resetTestDatabase);
  it.each([
    {
      key: "owner",
      scope: "workspace",
      isSystem: false,
      seesAll: true,
      allowed: false,
    },
    {
      key: "owner",
      scope: "workspace",
      isSystem: false,
      seesAll: false,
      allowed: false,
    },
    {
      key: "admin",
      scope: "workspace",
      isSystem: false,
      seesAll: true,
      allowed: false,
    },
    {
      key: "admin",
      scope: "workspace",
      isSystem: false,
      seesAll: false,
      allowed: false,
    },
    {
      key: "manager",
      scope: "workspace",
      isSystem: false,
      seesAll: true,
      allowed: false,
    },
    {
      key: "manager",
      scope: "workspace",
      isSystem: false,
      seesAll: false,
      allowed: false,
    },
    {
      key: "owner",
      scope: "workspace",
      isSystem: true,
      seesAll: false,
      allowed: true,
    },
    {
      key: "admin",
      scope: "workspace",
      isSystem: true,
      seesAll: true,
      allowed: true,
    },
    {
      key: "admin",
      scope: "workspace",
      isSystem: true,
      seesAll: false,
      allowed: true,
    },
    {
      key: "manager",
      scope: "workspace",
      isSystem: true,
      seesAll: true,
      allowed: true,
    },
    {
      key: "manager",
      scope: "workspace",
      isSystem: true,
      seesAll: false,
      allowed: true,
    },
    {
      key: "admin",
      scope: "project",
      isSystem: false,
      seesAll: false,
      allowed: true,
    },
  ])(
    "agrees for $scope $key (system=$isSystem, seesAll=$seesAll)",
    async ({ key, scope, isSystem, seesAll, allowed }) => {
      const { user, workspace } = await createWorkspaceMember({
        role: "member",
      });
      const { project } = await createProjectFixture({
        workspaceId: workspace.id,
      });
      const role = requireRow(
        await db
          .update(schema.roleTable)
          .set({ isSystem, scope })
          .where(
            and(
              eq(schema.roleTable.workspaceId, workspace.id),
              eq(schema.roleTable.scope, "workspace"),
              eq(schema.roleTable.key, key),
            ),
          )
          .returning(),
        "custom reserved role",
      );
      const person = requireRow(
        await db
          .select()
          .from(schema.personTable)
          .where(eq(schema.personTable.userId, user.id)),
        "person",
      );
      await db.insert(schema.membershipTable).values({
        personId: person.id,
        scope,
        scopeId: scope === "workspace" ? workspace.id : project.id,
        roleId: role.id,
        seesAll,
      });
      const identity = await resolveIdentity({
        userId: user.id,
        credential: "session",
      });
      if (!identity) throw new Error("missing staff identity");
      expect(
        reaches(identity, {
          projectId: project.id,
          workspaceId: workspace.id,
          organisationId: null,
        }),
      ).toBe(allowed);
      const rows = await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, project.id),
            currentProjectReachPredicate(
              identity,
              schema.projectTable.id,
              schema.projectTable.workspaceId,
              schema.projectTable.organisationId,
            ),
          ),
        );
      expect
        .soft(rows.map((row) => row.id))
        .toEqual(allowed ? [project.id] : []);
      const notificationRows = await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, project.id),
            projectReachPredicate(user.id),
          ),
        );
      expect(notificationRows.map((row) => row.id)).toEqual(
        allowed ? [project.id] : [],
      );
    },
  );

  it.each([
    { key: "owner", isSystem: true, allowed: true },
    { key: "admin", isSystem: true, allowed: true },
    { key: "manager", isSystem: true, allowed: true },
    { key: "admin", isSystem: false, allowed: false },
    { key: "manager", isSystem: false, allowed: false },
  ])(
    "agrees for legacy workspace_member-only $key (system=$isSystem) without membershipTable rows",
    async ({ key, isSystem, allowed }) => {
      const { user, workspace } = await createWorkspaceMember({
        role: key,
      });
      const { project } = await createProjectFixture({
        workspaceId: workspace.id,
      });
      await db
        .update(schema.roleTable)
        .set({ isSystem })
        .where(
          and(
            eq(schema.roleTable.workspaceId, workspace.id),
            eq(schema.roleTable.scope, "workspace"),
            eq(schema.roleTable.key, key),
          ),
        );
      const identity = await resolveIdentity({
        userId: user.id,
        credential: "session",
      });
      if (!identity) throw new Error("missing staff identity");
      expect(
        reaches(identity, {
          projectId: project.id,
          workspaceId: workspace.id,
          organisationId: null,
        }),
      ).toBe(allowed);
      const rows = await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, project.id),
            currentProjectReachPredicate(
              identity,
              schema.projectTable.id,
              schema.projectTable.workspaceId,
              schema.projectTable.organisationId,
            ),
          ),
        );
      expect(rows.map((row) => row.id)).toEqual(allowed ? [project.id] : []);
      const notificationRows = await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(
          and(
            eq(schema.projectTable.id, project.id),
            projectReachPredicate(user.id),
          ),
        );
      expect(notificationRows.map((row) => row.id)).toEqual(
        allowed ? [project.id] : [],
      );
    },
  );
});
