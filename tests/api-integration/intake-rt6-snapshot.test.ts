/** RT-6 / IQ-7 acceptance semantics (#761, owner decision): the triager may override the
 * work-item type; the snapshot pins form schema, SLA override and default assignee; an
 * ineligible default assignee leaves the item unassigned with the reason recorded in the
 * `submission.accepted` audit row; stale type references fail atomically. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { grantProjectRole, requireRow } from "./helpers/fixtures";
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
