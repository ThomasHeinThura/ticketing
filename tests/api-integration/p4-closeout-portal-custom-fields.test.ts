/**
 * CF-11: customer-visible custom fields on the portal request detail, and request-type forms
 * that collect them. A customer never sees (or writes) a field that is not customer-visible, and
 * the projection carries a label and a value only.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  customFieldTable,
  customFieldValueTable,
} from "../../apps/api/src/database/migration-schema";
import { publishRequestType } from "../../apps/api/src/intake/repository";
import { portalRequest } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  type IntakeSeed,
  seedIntake,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";
import { makeCustomField, setCustomValue } from "./helpers/p4-closeout";

async function linkedRequest(s: IntakeSeed) {
  const ref = await submitAs(s, s.customer);
  await db
    .update(schema.workItemTable)
    .set({ requesterId: s.customer.person.id })
    .where(eq(schema.workItemTable.id, s.t.workItem.id));
  const row = await submissionRow(ref);
  await db
    .update(schema.submissionTable)
    .set({ state: "accepted", workItemId: s.t.workItem.id })
    .where(eq(schema.submissionTable.id, row.id));
  return ref;
}

const detail = async (s: IntakeSeed, ref: string) => {
  const response = await portalRequest(
    s.t,
    s.customer,
    `/api/portal/submissions/${ref}`,
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  return {
    text,
    body: JSON.parse(text) as {
      customFields: {
        key: string;
        label: string;
        format: string;
        value: unknown;
      }[];
    },
  };
};

describe("CF-11 portal request detail", () => {
  beforeEach(async () => resetTestDatabase());

  it("shows only customer-visible, applicable, shown, non-empty, non-staff fields", async () => {
    const s = await seedIntake("cf11-detail");
    const ws = s.t.workspaceId;
    const type = s.t.type.id;
    const item = s.t.workItem;
    const visibleText = await makeCustomField(ws, type, {
      key: "order_no",
      format: "text",
      name: "Order number",
      customerVisible: true,
    });
    const visibleSelect = await makeCustomField(ws, type, {
      key: "impact",
      format: "select",
      name: "Impact",
      customerVisible: true,
      options: [
        { key: "imp_hi", label: "High impact" },
        { key: "imp_lo", label: "Low impact" },
      ],
    });
    const internal = await makeCustomField(ws, type, {
      key: "internal_cost",
      format: "number",
      customerVisible: false,
    });
    const staffPerson = await makeCustomField(ws, type, {
      key: "on_call",
      format: "user",
      customerVisible: true,
    });
    const empty = await makeCustomField(ws, type, {
      key: "never_set",
      format: "text",
      customerVisible: true,
    });
    const notForType = await makeCustomField(ws, type, {
      key: "other_type_only",
      format: "text",
      customerVisible: true,
      visible: false,
    });
    const target = { id: item.id, projectId: item.projectId };
    await setCustomValue(ws, visibleText.id, target, "ORD-1138");
    await setCustomValue(ws, visibleSelect.id, target, "imp_hi");
    await setCustomValue(ws, internal.id, target, 987654);
    await setCustomValue(ws, staffPerson.id, target, s.t.approverPerson.id);
    await setCustomValue(ws, notForType.id, target, "SECRET-OTHER-TYPE");
    void empty;

    const ref = await linkedRequest(s);
    const { text, body } = await detail(s, ref);
    expect(
      [...body.customFields].sort((a, b) => a.key.localeCompare(b.key)),
    ).toEqual([
      expect.objectContaining({
        key: "impact",
        label: "Impact",
        // The option label, never its stored key.
        value: "High impact",
      }),
      expect.objectContaining({
        key: "order_no",
        label: "Order number",
        value: "ORD-1138",
      }),
    ]);
    expect(text).not.toContain("987654");
    expect(text).not.toContain("SECRET-OTHER-TYPE");
    expect(text).not.toContain("imp_hi");
    // No field ids, no staff person id.
    expect(text).not.toContain(visibleText.id);
    expect(text).not.toContain(s.t.approverPerson.id);
  });

  it("does not let a conditional field leak the value of a staff-only controller (CF-6)", async () => {
    const s = await seedIntake("cf11-condition");
    const ws = s.t.workspaceId;
    const item = s.t.workItem;
    const internal = await makeCustomField(ws, s.t.type.id, {
      key: "escalation_tier",
      format: "text",
      customerVisible: false,
    });
    const shown = await makeCustomField(ws, s.t.type.id, {
      key: "vip_note",
      format: "text",
      customerVisible: true,
    });
    const open = await makeCustomField(ws, s.t.type.id, {
      key: "plain_note",
      format: "text",
      customerVisible: true,
    });
    await db
      .update(customFieldTable)
      .set({
        visibilityCondition: {
          field_key: "escalation_tier",
          op: "eq",
          value: "gold",
        },
      })
      .where(eq(customFieldTable.id, shown.id));
    const target = { id: item.id, projectId: item.projectId };
    await setCustomValue(ws, internal.id, target, "gold");
    await setCustomValue(ws, shown.id, target, "VIP-SECRET-NOTE");
    await setCustomValue(ws, open.id, target, "visible note");
    const ref = await linkedRequest(s);
    const { text, body } = await detail(s, ref);
    // The controller's value is "gold", so the conditional field WOULD be shown to staff, but
    // on the portal its presence would disclose the staff-only value: it is absent.
    expect(body.customFields.map((field) => field.key)).toEqual(["plain_note"]);
    expect(text).not.toContain("VIP-SECRET-NOTE");
    expect(text).not.toContain("gold");
  });

  it("makes a field disappear the moment it stops being customer-visible or is deleted", async () => {
    const s = await seedIntake("cf11-flip");
    const field = await makeCustomField(s.t.workspaceId, s.t.type.id, {
      key: "order_no",
      format: "text",
      customerVisible: true,
    });
    await setCustomValue(
      s.t.workspaceId,
      field.id,
      { id: s.t.workItem.id, projectId: s.t.workItem.projectId },
      "ORD-1",
    );
    const ref = await linkedRequest(s);
    expect((await detail(s, ref)).body.customFields).toHaveLength(1);
    await db
      .update(customFieldTable)
      .set({ customerVisible: false })
      .where(eq(customFieldTable.id, field.id));
    expect((await detail(s, ref)).body.customFields).toHaveLength(0);
    await db
      .update(customFieldTable)
      .set({ customerVisible: true, deletedAt: new Date() })
      .where(eq(customFieldTable.id, field.id));
    expect((await detail(s, ref)).body.customFields).toHaveLength(0);
  });
});

describe("CF-11 request-type forms collect customer-visible fields", () => {
  beforeEach(async () => resetTestDatabase());

  const form = (extra: unknown[]) => ({
    fields: [
      {
        key: "summary",
        type: "text",
        label: "Summary",
        required: true,
        mapsTo: { field: "title" },
      },
      ...extra,
    ],
  });

  async function draft(s: IntakeSeed, formSchema: unknown) {
    await db
      .update(schema.requestTypeTable)
      .set({ published: false, formSchema: formSchema as never })
      .where(eq(schema.requestTypeTable.id, s.requestType.id));
  }

  it("publishes a mapping to a customer-visible field and refuses the rest, naming the field", async () => {
    const s = await seedIntake("cf11-publish");
    const ws = s.t.workspaceId;
    await makeCustomField(ws, s.t.type.id, {
      key: "order_no",
      format: "text",
      customerVisible: true,
    });
    await makeCustomField(ws, s.t.type.id, {
      key: "internal_note",
      format: "text",
      customerVisible: false,
    });
    await makeCustomField(ws, s.t.type.id, {
      key: "score",
      format: "number",
      customerVisible: true,
    });
    const refuse = async (extra: unknown[]) => {
      await draft(s, form(extra));
      return publishRequestType(s.requestType.id, "test-actor").then(
        () => null,
        (error: { status?: number; message?: string }) => error,
      );
    };

    // Internal field: refused, named.
    const internal = await refuse([
      {
        key: "note",
        type: "text",
        label: "Note",
        mapsTo: { field: "cf.internal_note" },
      },
    ]);
    expect(internal?.status).toBe(422);
    expect(internal?.message).toContain("cf.internal_note");
    // Unknown field and wrong control for the format: refused.
    expect(
      (
        await refuse([
          {
            key: "x",
            type: "text",
            label: "X",
            mapsTo: { field: "cf.nope" },
          },
        ])
      )?.status,
    ).toBe(422);
    expect(
      (
        await refuse([
          {
            key: "score",
            type: "text",
            label: "Score",
            mapsTo: { field: "cf.score" },
          },
        ])
      )?.status,
    ).toBe(422);

    // A customer-visible field with a matching control publishes.
    await draft(
      s,
      form([
        {
          key: "order",
          type: "text",
          label: "Order",
          mapsTo: { field: "cf.order_no" },
        },
      ]),
    );
    await expect(
      publishRequestType(s.requestType.id, "test-actor"),
    ).resolves.toBeTruthy();
  });

  it("writes the customer's answer on acceptance, and drops one for a field made internal since", async () => {
    const s = await seedIntake("cf11-accept");
    const ws = s.t.workspaceId;
    const orderNo = await makeCustomField(ws, s.t.type.id, {
      key: "order_no",
      format: "text",
      customerVisible: true,
    });
    const impact = await makeCustomField(ws, s.t.type.id, {
      key: "impact",
      format: "select",
      customerVisible: true,
      options: [
        { key: "hi", label: "High" },
        { key: "lo", label: "Low" },
      ],
    });
    const snapshot = form([
      {
        key: "order",
        type: "text",
        label: "Order",
        mapsTo: { field: "cf.order_no" },
      },
      {
        key: "impact",
        type: "select",
        label: "Impact",
        options: ["hi", "lo"],
        mapsTo: { field: "cf.impact" },
      },
    ]);
    await db
      .update(schema.requestTypeVersionTable)
      .set({ formSchema: snapshot as never })
      .where(eq(schema.requestTypeVersionTable.id, s.version.id));
    const submit = await portalRequest(
      s.t,
      s.customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: {
          key: s.requestType.key,
          formData: { summary: "Broken", order: "ORD-7", impact: "hi" },
        },
      },
    );
    expect(submit.status, await submit.clone().text()).toBe(200);
    const ref = ((await submit.json()) as { ref: string }).ref;

    // The field is made internal after the form was published but before acceptance.
    await db
      .update(customFieldTable)
      .set({ customerVisible: false })
      .where(eq(customFieldTable.id, impact.id));
    const accepted = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/accept`,
      {
        method: "POST",
        body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
      },
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const created = (await submissionRow(ref)).workItemId ?? "";
    const values = await db
      .select()
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.entityId, created));
    const byField = new Map(
      values.map((row) => [row.customFieldId, row.value]),
    );
    expect(byField.get(orderNo.id)).toBe("ORD-7");
    expect(byField.has(impact.id)).toBe(false);
    const [audit] = (await db.select().from(schema.auditLogTable)).filter(
      (row) => row.action === "submission.accepted",
    );
    expect(JSON.stringify(audit?.after)).toContain("cf.impact");
  });
});
