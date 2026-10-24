import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  FeatureFlagConflictError,
  listInstanceFeatures,
  listProjectFeatures,
  listWorkspaceFeatures,
  patchInstanceFeatures,
  patchProjectFeatures,
  patchWorkspaceFeatures,
  resolveProjectFeatures,
} from "../../apps/api/src/feature-flag/repository";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function world() {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const identity = await resolveRequestIdentity({ userId: user.id });
  if (!identity) throw new Error("fixture identity did not resolve");
  const actor = { userId: user.id, personId: identity.personId };
  return { workspace, project, actor };
}

const row = <T extends { key: string }>(rows: T[], key: string) => {
  const found = rows.find((r) => r.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
};

describe("feature flag administration (ST-1, ST-2, ST-4, ST-5)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists every flag with its built-in default before anything is written", async () => {
    const flags = await listInstanceFeatures();
    expect(row(flags, "feature.cycles")).toMatchObject({
      enabled: false,
      source: "default",
      locked: false,
      version: 0,
      updatedBy: null,
    });
    expect(row(flags, "feature.import")).toMatchObject({
      enabled: true,
      locked: true,
    });
  });

  it("resolves project over workspace over instance, and reports what is inherited", async () => {
    const { workspace, project, actor } = await world();
    await patchInstanceFeatures(
      [{ key: "feature.cycles", enabled: true }],
      actor,
    );
    expect(
      row(await listWorkspaceFeatures(workspace.id), "feature.cycles"),
    ).toMatchObject({
      enabled: true,
      source: "instance",
      override: null,
      inherited: { enabled: true, source: "instance" },
    });

    await patchWorkspaceFeatures(
      workspace.id,
      [{ key: "feature.cycles", enabled: false }],
      actor,
    );
    expect(
      row(
        await listProjectFeatures(project.id, workspace.id),
        "feature.cycles",
      ),
    ).toMatchObject({
      enabled: false,
      source: "workspace",
      override: null,
      inherited: { enabled: false, source: "workspace" },
    });

    await patchProjectFeatures(
      project.id,
      workspace.id,
      [{ key: "feature.cycles", enabled: true }],
      actor,
    );
    expect(
      row(
        await resolveProjectFeatures(project.id, workspace.id),
        "feature.cycles",
      ),
    ).toMatchObject({ enabled: true, source: "project" });

    // `null` clears the override and the flag falls back to the workspace value.
    await patchProjectFeatures(
      project.id,
      workspace.id,
      [{ key: "feature.cycles", enabled: null }],
      actor,
    );
    expect(
      row(
        await resolveProjectFeatures(project.id, workspace.id),
        "feature.cycles",
      ),
    ).toMatchObject({ enabled: false, source: "workspace" });
  });

  it("ST-2: a write below a locked instance flag is refused naming the lock", async () => {
    const { workspace, project, actor } = await world();
    await patchInstanceFeatures(
      [{ key: "feature.sla", enabled: true, locked: true }],
      actor,
    );
    await expect(
      patchWorkspaceFeatures(
        workspace.id,
        [{ key: "feature.sla", enabled: false }],
        actor,
      ),
    ).rejects.toMatchObject({ code: "feature_locked", key: "feature.sla" });
    await expect(
      patchProjectFeatures(
        project.id,
        workspace.id,
        [{ key: "feature.sla", enabled: false }],
        actor,
      ),
    ).rejects.toBeInstanceOf(FeatureFlagConflictError);
    // Nothing was written below the lock, and clearing is refused too.
    expect(
      await db.select().from(schema.workspaceFeatureFlagTable),
    ).toHaveLength(0);
    expect(
      row(
        await resolveProjectFeatures(project.id, workspace.id),
        "feature.sla",
      ),
    ).toMatchObject({ enabled: true, source: "instance", locked: true });
  });

  it("a refused change in a batch writes none of the batch", async () => {
    const { workspace, actor } = await world();
    await patchInstanceFeatures(
      [{ key: "feature.sla", enabled: true, locked: true }],
      actor,
    );
    await expect(
      patchWorkspaceFeatures(
        workspace.id,
        [
          { key: "feature.cycles", enabled: true },
          { key: "feature.sla", enabled: false },
        ],
        actor,
      ),
    ).rejects.toBeInstanceOf(FeatureFlagConflictError);
    expect(
      await db.select().from(schema.workspaceFeatureFlagTable),
    ).toHaveLength(0);
  });

  it("the built-in lock on import holds until an instance row unlocks it", async () => {
    const { workspace, actor } = await world();
    await expect(
      patchWorkspaceFeatures(
        workspace.id,
        [{ key: "feature.import", enabled: false }],
        actor,
      ),
    ).rejects.toMatchObject({ code: "feature_locked" });
    await patchInstanceFeatures(
      [{ key: "feature.import", locked: false }],
      actor,
    );
    await patchWorkspaceFeatures(
      workspace.id,
      [{ key: "feature.import", enabled: false }],
      actor,
    );
    expect(
      row(await listWorkspaceFeatures(workspace.id), "feature.import"),
    ).toMatchObject({ enabled: false, source: "workspace" });
  });

  it("answers a stale expectedVersion with a version conflict", async () => {
    const { actor } = await world();
    await patchInstanceFeatures(
      [{ key: "feature.reports", enabled: true }],
      actor,
    );
    await expect(
      patchInstanceFeatures(
        [{ key: "feature.reports", enabled: false, expectedVersion: 0 }],
        actor,
      ),
    ).rejects.toMatchObject({ code: "version_conflict", version: 1 });
    await patchInstanceFeatures(
      [{ key: "feature.reports", enabled: false, expectedVersion: 1 }],
      actor,
    );
    expect(row(await listInstanceFeatures(), "feature.reports")).toMatchObject({
      enabled: false,
      version: 2,
    });
  });

  it("ST-5: records who changed a flag and when, and ST-6: audits each change", async () => {
    const { workspace, actor } = await world();
    await patchWorkspaceFeatures(
      workspace.id,
      [{ key: "feature.pages", enabled: true }],
      actor,
    );
    const view = row(
      await listWorkspaceFeatures(workspace.id),
      "feature.pages",
    );
    expect(view.updatedBy?.id).toBe(actor.personId);
    expect(view.updatedAt).not.toBeNull();

    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "feature_flag.changed"),
          eq(schema.auditLogTable.entityId, workspace.id),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityType: "workspace",
      workspaceId: workspace.id,
      actorId: actor.userId,
    });
  });

  it("an unchanged value writes no row, no version bump and no audit", async () => {
    const { workspace, actor } = await world();
    await patchWorkspaceFeatures(
      workspace.id,
      [{ key: "feature.pages", enabled: true }],
      actor,
    );
    await patchWorkspaceFeatures(
      workspace.id,
      [{ key: "feature.pages", enabled: true }],
      actor,
    );
    expect(
      row(await listWorkspaceFeatures(workspace.id), "feature.pages").version,
    ).toBe(1);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "feature_flag.changed"));
    expect(audit).toHaveLength(1);
  });
});
