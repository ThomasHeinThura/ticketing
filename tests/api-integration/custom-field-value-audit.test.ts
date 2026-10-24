/**
 * P4R1-M7: a custom-field value edit writes an `updated`/`custom_field` activity row (internal
 * unless the field is customer visible, CA-7), an unchanged value writes nothing, and editing a
 * field's attributes records the full before/after in `custom_field.updated`.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { updateField } from "../../apps/api/src/custom-field/repository";
import db, { schema } from "../../apps/api/src/database";
import updateWorkItem from "../../apps/api/src/work-item/controllers/update-work-item";
import { buildTenant, type Tenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { makeCustomField } from "./helpers/p4-closeout";

async function customFieldActivity(t: Tenant) {
  return db
    .select()
    .from(schema.activityTable)
    .where(
      and(
        eq(schema.activityTable.workItemId, t.workItem.id),
        eq(schema.activityTable.field, "custom_field"),
      ),
    );
}

async function edit(
  t: Tenant,
  version: number,
  values: Record<string, unknown>,
) {
  return updateWorkItem(
    t.workItem.key,
    t.workspaceId,
    version,
    t.requester.user.id,
    "person",
    { customFields: values },
  );
}

describe("custom field audit trail", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("writes an internal activity row naming the field, none for an unchanged value", async () => {
    const t = await buildTenant("cf-activity");
    await makeCustomField(t.workspaceId, t.type.id, {
      key: "region",
      name: "Region",
      format: "text",
    });
    const first = await edit(t, t.workItem.version, { region: "EMEA" });
    const rows = await customFieldActivity(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verb: "updated",
      field: "custom_field",
      oldValue: null,
      newValue: "EMEA",
      visibility: "internal",
      actorId: t.requester.user.id,
    });
    expect(rows[0]?.payload).toMatchObject({ key: "region", name: "Region" });

    await edit(t, first.version, { region: "EMEA" });
    expect(await customFieldActivity(t)).toHaveLength(1);
  });

  it("is public only for a customer-visible field (CA-7)", async () => {
    const t = await buildTenant("cf-activity-public");
    await makeCustomField(t.workspaceId, t.type.id, {
      key: "ref",
      format: "text",
      customerVisible: true,
    });
    await edit(t, t.workItem.version, { ref: "A-1" });
    expect((await customFieldActivity(t))[0]?.visibility).toBe("public");
  });

  it("records the full before/after attributes when a field is edited", async () => {
    const t = await buildTenant("cf-audit-attrs");
    const field = await makeCustomField(t.workspaceId, t.type.id, {
      key: "tier",
      format: "text",
    });
    await updateField(
      field.id,
      t.workspaceId,
      { customerVisible: true, helpText: "Shown to customers" },
      { userId: t.requester.user.id, actorType: "person" },
    );
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "custom_field.updated"));
    expect(audit?.before).toMatchObject({ customerVisible: false });
    expect(audit?.after).toMatchObject({
      customerVisible: true,
      helpText: "Shown to customers",
    });
  });
});
