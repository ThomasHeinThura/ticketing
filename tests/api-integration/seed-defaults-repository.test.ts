/**
 * #580 batch 10: predicates of the default-data seed repository that the existing seed
 * suites did not pin -- a project's own state check, workspace-scoped template adoption and
 * conflict-tolerant staff-person batches.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { insertStaffPersonBatch } from "../../apps/api/src/utils/seed-defaults.repository";
import { seedProjectStates } from "../../apps/api/src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

describe("API integration: seed defaults repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("seeds each project's own states from its own workspace's templates only", async () => {
    const a = await createWorkspaceMember({ role: "admin" });
    const b = await createWorkspaceMember({ role: "admin" });
    await seedWorkspaceDefaults(a.workspace.id);
    await db.insert(schema.stateTemplateTable).values({
      workspaceId: b.workspace.id,
      key: "only-b",
      name: "Only B",
      group: "backlog",
    });
    const projectA = (
      await createProjectFixture({ workspaceId: a.workspace.id })
    ).project;
    const projectB = (
      await createProjectFixture({ workspaceId: b.workspace.id })
    ).project;
    // createProjectFixture does not seed states; project A is seeded first.
    await seedProjectStates(projectA.id, a.workspace.id);
    const aStates = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, projectA.id));
    expect(aStates.length).toBeGreaterThan(1);

    // Project A already having states must not stop project B from being seeded...
    await seedProjectStates(projectB.id, b.workspace.id);
    const bStates = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, projectB.id));
    // ...and B adopts only its own workspace's template, not A's.
    expect(bStates).toHaveLength(1);
    const template = requireRow(
      await db
        .select()
        .from(schema.stateTemplateTable)
        .where(
          eq(schema.stateTemplateTable.id, bStates[0]?.stateTemplateId ?? ""),
        ),
      "template",
    );
    expect(template.workspaceId).toBe(b.workspace.id);
    expect(bStates[0]?.isDefault).toBe(true);

    // Re-running changes nothing.
    await seedProjectStates(projectA.id, a.workspace.id);
    await seedProjectStates(projectB.id, b.workspace.id);
    expect(
      await db
        .select()
        .from(schema.stateTable)
        .where(eq(schema.stateTable.projectId, projectA.id)),
    ).toHaveLength(aStates.length);
  });

  it("a staff-person batch tolerates users that already have a person", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const fresh = await createWorkspaceMember({ role: "member" });
    const [existing] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id));
    const organisationId = existing?.organisationId ?? "";
    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.userId, fresh.user.id));

    await insertStaffPersonBatch([
      { userId: member.user.id, organisationId, side: "staff" },
      { userId: fresh.user.id, organisationId, side: "staff" },
    ]);

    const rows = await db
      .select({ userId: schema.personTable.userId })
      .from(schema.personTable);
    expect(rows.filter((r) => r.userId === member.user.id)).toHaveLength(1);
    expect(rows.filter((r) => r.userId === fresh.user.id)).toHaveLength(1);
  });
});
