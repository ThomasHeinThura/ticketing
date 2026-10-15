/**
 * #580 batch 6: direct tests for the `utils/` authorization lookups now owned by
 * repositories -- reach (workspace membership, global admin, API-key ownership), the
 * soft-delete rules, role and membership reads, assignee locks, invitations and the
 * asset / task / label facts. Each assertion pins one predicate the helpers rely on.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  countOwnerRows,
  findActiveApiKeyByHash,
  findApiKeyOwnerStatus,
  findInvitationWorkspaceId,
  findLabelTaskId,
  findLiveTaskFacts,
  findMembershipRole,
  findRoleIsSystem,
  findUserIsAnonymous,
  findUserLocaleByEmail,
  findUserRole,
  findWorkspaceDeniedAsset,
  findWorkspaceReachableAsset,
  listEnabledApiKeysOfUser,
  listMemberRoleRows,
  listRolePermissionRows,
  listWorkspaceMembershipRows,
} from "../../apps/api/src/utils/access-lookups.repository";
import {
  findLiveProjectWorkspaceId,
  listAdminUserIds,
  listWorkspaceMemberUserIds,
  lockWorkspaceMembershipRow,
  shareLockAdminUser,
} from "../../apps/api/src/utils/assignable-user.repository";
import {
  findInvitationWithNames,
  findPendingInvitation,
  listPendingInvitationsForEmail,
} from "../../apps/api/src/utils/registration.repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function seedTask(projectId: string, columnId: string, number = 1) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Task",
        status: "to-do",
        columnId,
        priority: "medium",
        number,
        position: number,
      })
      .returning(),
    "task",
  );
}

async function apiKey(
  userId: string,
  overrides: Partial<typeof schema.apikeyTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(schema.apikeyTable)
      .values({
        key: `hash-${Math.random()}`,
        userId,
        referenceId: userId,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      } as typeof schema.apikeyTable.$inferInsert)
      .returning(),
    "apikey",
  );
}

describe("API integration: asset, task and label reach facts", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("asset lookups: reachable for the member, denied evidence only for a live project the caller cannot reach", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const outsider = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db.insert(schema.assetTable).values({
      id: "asset1",
      workspaceId: member.workspace.id,
      projectId: project.id,
      objectKey: "k/asset1",
      filename: "a.png",
      mimeType: "image/png",
      size: 1,
    });

    expect(
      await findWorkspaceReachableAsset("asset1", member.user.id),
    ).toMatchObject({ id: "asset1", workspaceId: member.workspace.id });
    expect(
      await findWorkspaceReachableAsset("asset1", outsider.user.id),
    ).toBeUndefined();
    expect(
      await findWorkspaceDeniedAsset("asset1", member.user.id),
    ).toBeUndefined();
    expect(await findWorkspaceDeniedAsset("asset1", outsider.user.id)).toEqual({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    expect(
      await findWorkspaceDeniedAsset("asset1", outsider.user.id),
    ).toBeUndefined();
  });

  it("task, label, invitation and organisation facts", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);
    await db.insert(schema.labelTable).values({
      id: "label1",
      name: "L",
      color: "#fff",
      workspaceId: member.workspace.id,
      taskId: task.id,
    } as typeof schema.labelTable.$inferInsert);

    expect(await findLiveTaskFacts(task.id)).toEqual({
      id: task.id,
      projectId: project.id,
      workspaceId: member.workspace.id,
    });
    expect(await findLabelTaskId("label1")).toEqual({ taskId: task.id });
    expect(await findLabelTaskId("none")).toBeUndefined();
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    expect(await findLiveTaskFacts(task.id)).toBeUndefined();
  });
});

describe("API integration: principal, key, membership and role lookups", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("user facts and API-key predicates", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const other = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.userTable)
      .set({ role: "admin", isAnonymous: true, locale: "fr" })
      .where(eq(schema.userTable.id, member.user.id));

    expect(await findUserRole(member.user.id)).toEqual({ role: "admin" });
    expect((await findUserRole(other.user.id))?.role).not.toBe("admin");
    expect(await findUserRole("none")).toBeUndefined();
    expect(await findUserIsAnonymous(member.user.id)).toEqual({
      isAnonymous: true,
    });
    expect(await findUserLocaleByEmail(member.user.email)).toEqual({
      locale: "fr",
    });
    expect(await findUserLocaleByEmail("nobody@example.com")).toBeUndefined();

    const mine = await apiKey(member.user.id);
    expect(
      await listEnabledApiKeysOfUser(mine.id, member.user.id),
    ).toHaveLength(1);
    expect(await listEnabledApiKeysOfUser(mine.id, other.user.id)).toHaveLength(
      0,
    );
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, mine.id));
    expect(
      await listEnabledApiKeysOfUser(mine.id, member.user.id),
    ).toHaveLength(0);

    const hash = createHash("sha256").update("secret").digest("hex");
    const live = await apiKey(member.user.id, { key: hash });
    expect((await findActiveApiKeyByHash(hash))?.id).toBe(live.id);
    await db
      .update(schema.apikeyTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.apikeyTable.id, live.id));
    expect(await findActiveApiKeyByHash(hash)).toBeUndefined();
    await db
      .update(schema.apikeyTable)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.apikeyTable.id, live.id));
    expect((await findActiveApiKeyByHash(hash))?.id).toBe(live.id);
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, live.id));
    expect(await findActiveApiKeyByHash(hash)).toBeUndefined();

    expect(await findApiKeyOwnerStatus(member.user.id)).toMatchObject({
      personActive: true,
    });
    expect(await findApiKeyOwnerStatus("none")).toBeUndefined();
  });

  it("membership and role reads are scoped to the workspace and user", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "member" });

    expect(await findMembershipRole(owner.user.id, owner.workspace.id)).toEqual(
      { role: "owner" },
    );
    expect(
      await findMembershipRole(owner.user.id, other.workspace.id),
    ).toBeUndefined();
    expect(
      await listWorkspaceMembershipRows(owner.user.id, owner.workspace.id),
    ).toHaveLength(1);
    expect(
      await listWorkspaceMembershipRows(other.user.id, owner.workspace.id),
    ).toHaveLength(0);
    expect(
      await listMemberRoleRows(db, owner.workspace.id, owner.user.id),
    ).toEqual([{ role: "owner" }]);
    expect(
      await listMemberRoleRows(db, owner.workspace.id, other.user.id),
    ).toEqual([]);
    expect((await countOwnerRows(db, owner.workspace.id))?.owners).toBe(1);
    expect((await countOwnerRows(db, other.workspace.id))?.owners).toBe(0);

    const admin = await createWorkspaceMember({ role: "admin" });
    expect(
      await listRolePermissionRows(db, admin.workspace.id, "admin"),
    ).toHaveLength(1);
    expect(
      await listRolePermissionRows(db, other.workspace.id, "admin"),
    ).toHaveLength(0);
    expect(await findRoleIsSystem(db, admin.workspace.id, "admin")).toEqual({
      isSystem: true,
    });
    expect(
      await findRoleIsSystem(db, other.workspace.id, "admin"),
    ).toBeUndefined();
  });

  it("assignee lookups: members, admins, locks and the soft-delete rule", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const stranger = await createWorkspaceMember({ role: "member" });
    const admin = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    expect(
      await listWorkspaceMemberUserIds(
        [member.user.id, stranger.user.id],
        member.workspace.id,
      ),
    ).toEqual([{ userId: member.user.id }]);
    expect(
      await listAdminUserIds([member.user.id, admin.user.id, stranger.user.id]),
    ).toEqual([{ id: admin.user.id }]);

    await db.transaction(async (tx) => {
      expect(
        await lockWorkspaceMembershipRow(
          tx,
          member.user.id,
          member.workspace.id,
        ),
      ).toHaveLength(1);
      expect(
        await lockWorkspaceMembershipRow(
          tx,
          stranger.user.id,
          member.workspace.id,
        ),
      ).toHaveLength(0);
      expect(await shareLockAdminUser(tx, admin.user.id)).toEqual({
        id: admin.user.id,
      });
      expect(await shareLockAdminUser(tx, member.user.id)).toBeUndefined();
    });

    expect(await findLiveProjectWorkspaceId(project.id)).toEqual({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    expect(await findLiveProjectWorkspaceId(project.id)).toBeUndefined();
  });

  it("invitation lookups: pending and unexpired only, email lower-cased, oldest first", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const inv = (
      id: string,
      email: string,
      status: string,
      expiresAt: Date,
      createdAt: Date,
    ) =>
      db.insert(schema.invitationTable).values({
        id,
        workspaceId: owner.workspace.id,
        email,
        status,
        expiresAt,
        createdAt,
        inviterId: owner.user.id,
      });
    await inv(
      "i-new",
      "a@example.com",
      "pending",
      future,
      new Date("2026-02-01"),
    );
    await inv(
      "i-old",
      "a@example.com",
      "pending",
      future,
      new Date("2026-01-01"),
    );
    await inv(
      "i-expired",
      "a@example.com",
      "pending",
      past,
      new Date("2026-01-02"),
    );
    await inv(
      "i-accepted",
      "a@example.com",
      "accepted",
      future,
      new Date("2026-01-03"),
    );
    await inv(
      "i-other",
      "b@example.com",
      "pending",
      future,
      new Date("2026-01-04"),
    );
    const now = new Date();

    expect(
      (await findPendingInvitation({ invitationId: "i-new", now }))?.id,
    ).toBe("i-new");
    expect(
      await findPendingInvitation({ invitationId: "i-expired", now }),
    ).toBeUndefined();
    expect(
      await findPendingInvitation({ invitationId: "i-accepted", now }),
    ).toBeUndefined();
    expect(
      (await findPendingInvitation({ email: "B@Example.com", now }))?.id,
    ).toBe("i-other");
    expect(
      await findPendingInvitation({
        invitationId: "i-new",
        email: "b@example.com",
        now,
      }),
    ).toBeUndefined();

    const details = await findInvitationWithNames("i-accepted");
    expect(details).toMatchObject({
      status: "accepted",
      workspaceName: owner.workspace.name,
    });
    expect(await findInvitationWithNames("none")).toBeUndefined();

    expect(
      (await listPendingInvitationsForEmail("A@Example.com", now)).map(
        (r) => r.id,
      ),
    ).toEqual(["i-old", "i-new"]);
    expect(await findInvitationWorkspaceId("i-new")).toEqual({
      workspaceId: owner.workspace.id,
    });
    expect(await findInvitationWorkspaceId("none")).toBeUndefined();
  });
});
