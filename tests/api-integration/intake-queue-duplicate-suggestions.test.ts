import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { suggestDuplicatesForQueueRows } from "../../apps/api/src/intake/duplicate-suggestions";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { seedIntake, staffRequest, submitAs } from "./helpers/intake-http";

const summary = "Cannot sign in to TaskDesk service desk";
type Seed = Awaited<ReturnType<typeof seedIntake>>;
async function candidate(s: Seed, organisationId: string, hidden?: "archived") {
  const { project } = await createProjectFixture({
    workspaceId: s.t.workspaceId,
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId, ...(hidden ? { archivedAt: new Date() } : {}) })
    .where(eq(schema.projectTable.id, project.id));
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: s.t.backlog.id,
        isDefault: true,
      })
      .returning(),
    "suggestion state",
  );
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: s.t.workspaceId,
        projectId: project.id,
        typeId: s.t.type.id,
        stateId: state.id,
        title: summary,
        key: `SUGGEST-${randomUUID()}`,
        number: 1,
      })
      .returning(),
    "suggestion item",
  );
  return { project, item };
}

describe("inline intake duplicate suggestions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  it("filters inaccessible, foreign-organisation, archived and expired candidates before per-row limits", async () => {
    const s = await seedIntake("iq5-inline");
    await db
      .update(schema.workItemTable)
      .set({ title: summary })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));
    const hidden = await candidate(s, s.customer.orgId);
    const archived = await candidate(s, s.customer.orgId, "archived");
    const foreign = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `other-${randomUUID()}`,
          name: "Other suggestion organisation",
        })
        .returning(),
      "foreign org",
    );
    const foreignCandidate = await candidate(s, foreign.id);
    const stale = await candidate(s, s.customer.orgId);
    await db
      .update(schema.workItemTable)
      .set({ createdAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(eq(schema.workItemTable.id, stale.item.id));
    const grouped = await suggestDuplicatesForQueueRows(
      s.t.workspaceId,
      [
        { ref: "SUB-1", summary, organisationId: s.customer.orgId },
        {
          ref: "SUB-2",
          summary: "Banana harvest weather forecast",
          organisationId: s.customer.orgId,
        },
      ],
      [
        s.t.project.id,
        archived.project.id,
        foreignCandidate.project.id,
        stale.project.id,
      ],
    );
    expect(grouped.get("SUB-1")?.map((item) => item.key)).toEqual([
      s.t.workItem.key,
    ]);
    expect(JSON.stringify([...grouped])).not.toContain(hidden.item.id);
    expect(grouped.get("SUB-2") ?? []).toEqual([]);
  });
  it("enriches the normal paged queue and withholds suggestions from a triager without item read", async () => {
    const s = await seedIntake("iq5-route");
    await db
      .update(schema.workItemTable)
      .set({ title: summary })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));
    const ref = await submitAs(s, s.customer, summary);
    const response = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions?workspaceId=${s.t.workspaceId}&limit=1`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const page = (await response.json()) as {
      submissions: Array<{
        ref: string;
        suggestedDuplicates: Array<{ key: string }>;
      }>;
      meta: { total: number };
    };
    expect(page.meta.total).toBe(1);
    expect(page.submissions[0]?.ref).toBe(ref);
    expect(
      page.submissions[0]?.suggestedDuplicates.map((item) => item.key),
    ).toEqual([s.t.workItem.key]);
    const lead = await createWorkspaceMember({ role: "lead" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: s.t.workspaceId,
      userId: lead.user.id,
      role: "lead",
      joinedAt: new Date(),
    });
    const capabilities = await staffRequest(
      s.t,
      lead,
      `/api/capabilities?workspaceId=${s.t.workspaceId}`,
    );
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ triageIntake: true });
    const denied = await staffRequest(
      s.t,
      lead,
      `/api/submissions?workspaceId=${s.t.workspaceId}`,
    );
    expect(denied.status, await denied.clone().text()).toBe(200);
    const restricted = (await denied.json()) as typeof page;
    expect(restricted.meta.total).toBe(1);
    expect(restricted.submissions[0]?.suggestedDuplicates).toEqual([]);
  });
});
