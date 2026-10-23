/** RT-6 / IQ-7 acceptance semantics (#761, owner decision): the triager may override the
 * work-item type; the snapshot pins form schema, SLA override and default assignee; an
 * ineligible default assignee leaves the item unassigned with the reason recorded in the
 * `submission.accepted` audit row; stale type references fail atomically. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import {
  type IntakeSeed,
  seedIntake,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";
import { addMember } from "./helpers/reach-world";

const workItems = async () =>
  (await db.select().from(schema.workItemTable)).length;

async function otherType(workspaceId: string) {
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Override",
        category: "delivery",
      })
      .returning(),
    "override type",
  );
}

const setDefaultAssignee = (s: IntakeSeed, personId: string) =>
  db
    .update(schema.requestTypeVersionTable)
    .set({ defaultAssigneeId: personId })
    .where(eq(schema.requestTypeVersionTable.id, s.version.id));

async function accept(s: IntakeSeed, ref: string, typeId: string) {
  return staffRequest(s.t, s.t.requester, `/api/submissions/${ref}/accept`, {
    method: "POST",
    body: { projectId: s.t.project.id, workItemTypeId: typeId },
  });
}

const acceptedAudit = async () =>
  (await db.select().from(schema.auditLogTable)).filter(
    (row) => row.action === "submission.accepted",
  );

describe("RT-6 / IQ-7 acceptance (#761)", () => {
  beforeEach(async () => resetTestDatabase());

  it("lets the triager override the snapshotted work-item type", async () => {
    const s = await seedIntake("rt6-override");
    const override = await otherType(s.t.workspaceId);
    const ref = await submitAs(s, s.customer);
    const response = await accept(s, ref, override.id);
    expect(response.status, await response.clone().text()).toBe(200);
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(
        eq(
          schema.workItemTable.id,
          (await submissionRow(ref)).workItemId ?? "",
        ),
      );
    expect(item?.typeId).toBe(override.id);
    expect(item?.typeId).not.toBe(s.version.workItemTypeId);
  });

  it("assigns an eligible snapshotted default assignee", async () => {
    const s = await seedIntake("rt6-assignee-ok");
    const member = await addMember(s.t.workspaceId, "admin");
    await grantProjectRole(member.user.id, s.t.project.id, ["work_item:read"]);
    await setDefaultAssignee(s, member.personId);
    const ref = await submitAs(s, s.customer);
    expect((await accept(s, ref, s.t.type.id)).status).toBe(200);
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(
        eq(
          schema.workItemTable.id,
          (await submissionRow(ref)).workItemId ?? "",
        ),
      );
    expect(item?.assigneeId).toBe(member.personId);
    expect(JSON.stringify((await acceptedAudit())[0]?.after)).not.toContain(
      "defaultAssigneeSkipped",
    );
  });

  // P1-11 (UNRUN: DB integration): a default-assigned conversion is not silent to the
  // assignee -- same event, activity, notification fan-out and implicit watcher as create.
  async function expectAssignmentSideEffects(
    s: IntakeSeed,
    ref: string,
    personId: string,
  ) {
    const itemId = (await submissionRow(ref)).workItemId ?? "";
    const watchers = await db
      .select()
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, itemId));
    expect(watchers.find((w) => w.personId === personId)?.source).toBe(
      "implicit",
    );
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, itemId));
    expect(
      activity.some(
        (row) => row.field === "assigneeId" && row.newValue === personId,
      ),
    ).toBe(true);
    const events = await db.select().from(schema.outboxTable);
    expect(
      events.filter(
        (row) =>
          row.kind === "work_item.assigned" &&
          row.workspaceId === s.t.workspaceId,
      ),
    ).toHaveLength(1);
  }

  it("records assignment event, activity and implicit watcher for the request-type default (P1-11)", async () => {
    const s = await seedIntake("rt6-assignee-events");
    const member = await addMember(s.t.workspaceId, "admin");
    await grantProjectRole(member.user.id, s.t.project.id, ["work_item:read"]);
    await setDefaultAssignee(s, member.personId);
    const ref = await submitAs(s, s.customer);
    expect((await accept(s, ref, s.t.type.id)).status).toBe(200);
    await expectAssignmentSideEffects(s, ref, member.personId);
  });

  it("records assignment event, activity and implicit watcher for the project-default fallback (P1-11)", async () => {
    const s = await seedIntake("rt6-project-default-events");
    const member = await addMember(s.t.workspaceId, "admin");
    await grantProjectRole(member.user.id, s.t.project.id, ["work_item:read"]);
    await db
      .update(schema.projectTable)
      .set({ defaultAssigneeId: member.personId })
      .where(eq(schema.projectTable.id, s.t.project.id));
    const ref = await submitAs(s, s.customer);
    expect((await accept(s, ref, s.t.type.id)).status).toBe(200);
    await expectAssignmentSideEffects(s, ref, member.personId);
  });

  it.each([
    ["not a project member", "not_a_project_member"],
    ["inactive", "inactive"],
    ["not staff", "not_staff"],
  ])(
    "leaves the item unassigned and records why when the default assignee is %s",
    async (kind, reason) => {
      const s = await seedIntake(`rt6-assignee-${reason}`);
      let personId: string;
      if (kind === "not a project member") {
        personId = (await addMember(s.t.workspaceId, "admin")).personId;
      } else if (kind === "inactive") {
        const member = await addMember(s.t.workspaceId, "admin");
        await grantProjectRole(member.user.id, s.t.project.id, [
          "work_item:read",
        ]);
        await db
          .update(schema.personTable)
          .set({ active: false })
          .where(eq(schema.personTable.id, member.personId));
        personId = member.personId;
      } else {
        const member = await addMember(s.t.workspaceId, "admin");
        await grantProjectRole(member.user.id, s.t.project.id, [
          "work_item:read",
        ]);
        await db
          .update(schema.personTable)
          .set({ side: "customer" })
          .where(eq(schema.personTable.id, member.personId));
        personId = member.personId;
      }
      await setDefaultAssignee(s, personId);
      const ref = await submitAs(s, s.customer);
      const response = await accept(s, ref, s.t.type.id);
      expect(response.status, await response.clone().text()).toBe(200);
      const row = await submissionRow(ref);
      expect(row.state).toBe("accepted");
      const [item] = await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, row.workItemId ?? ""));
      expect(item?.assigneeId).toBeNull();
      const audits = await acceptedAudit();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.after).toMatchObject({
        defaultAssigneeSkipped: { personId, reason },
      });
    },
  );

  // UNRUN (DB integration): review Q3 -- a parent-project member as default assignee is
  // eligible at intake (PR-2), same as on canonical create.
  it("assigns a default assignee who is a member of an ancestor project (PR-2)", async () => {
    const s = await seedIntake("rt6-assignee-ancestor");
    const { project: parent } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
    });
    await db
      .update(schema.projectTable)
      .set({ parentId: parent.id })
      .where(eq(schema.projectTable.id, s.t.project.id));
    const member = await addMember(s.t.workspaceId, "admin");
    await grantProjectRole(member.user.id, parent.id, ["work_item:read"]);
    await setDefaultAssignee(s, member.personId);
    const ref = await submitAs(s, s.customer);
    const response = await accept(s, ref, s.t.type.id);
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await submissionRow(ref);
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, row.workItemId ?? ""));
    expect(item?.assigneeId).toBe(member.personId);
  });

  it("fails atomically for a work-item type outside the workspace", async () => {
    const s = await seedIntake("rt6-stale-type");
    const ref = await submitAs(s, s.customer);
    const before = await workItems();
    const response = await accept(s, ref, `missing-${randomUUID()}`);
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await workItems()).toBe(before);
    const row = await submissionRow(ref);
    expect(row.state).toBe("new");
    expect(row.workItemId).toBeNull();
    expect(await acceptedAudit()).toHaveLength(0);
  });

  it("cannot reference an SLA policy of another workspace in a snapshot (database-enforced)", async () => {
    const s = await seedIntake("rt6-stale-policy");
    const other = await seedIntake("rt6-stale-policy-other");
    const policy = requireRow(
      await db
        .insert(schema.slaPolicyTable)
        .values({ workspaceId: other.t.workspaceId, name: "Foreign" })
        .returning(),
      "foreign policy",
    );
    await expect(
      db
        .update(schema.requestTypeVersionTable)
        .set({ slaPolicyId: policy.id })
        .where(eq(schema.requestTypeVersionTable.id, s.version.id)),
    ).rejects.toThrow();
  });
});
