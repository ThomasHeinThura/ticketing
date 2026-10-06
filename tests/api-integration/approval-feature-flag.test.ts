import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveApprovalFeatureFlag } from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

describe("approval feature-flag repository resolution", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("applies project, workspace, instance, lock, then built-in default precedence", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const target = { workspaceId: workspace.id, projectId: project.id };

    expect(await resolveApprovalFeatureFlag(target)).toEqual({
      enabled: false,
      source: "default",
    });

    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.approvals",
      enabled: true,
    });
    expect(await resolveApprovalFeatureFlag(target)).toEqual({
      enabled: true,
      source: "instance",
    });

    await db.insert(schema.workspaceFeatureFlagTable).values({
      workspaceId: workspace.id,
      featureKey: "feature.approvals",
      enabled: false,
    });
    expect(await resolveApprovalFeatureFlag(target)).toEqual({
      enabled: false,
      source: "workspace",
    });

    await db.insert(schema.projectFeatureFlagTable).values({
      projectId: project.id,
      featureKey: "feature.approvals",
      enabled: true,
    });
    expect(await resolveApprovalFeatureFlag(target)).toEqual({
      enabled: true,
      source: "project",
    });

    await db
      .update(schema.instanceFeatureFlagTable)
      .set({ enabled: false, locked: true })
      .where(
        eq(schema.instanceFeatureFlagTable.featureKey, "feature.approvals"),
      );
    expect(await resolveApprovalFeatureFlag(target)).toEqual({
      enabled: false,
      source: "instance",
    });
  });
});
