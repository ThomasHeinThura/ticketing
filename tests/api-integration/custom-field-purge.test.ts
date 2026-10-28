/**
 * CF-8: a custom field soft-deleted more than 30 days ago is hard-deleted by `custom-field-purge`
 * together with its values and visibility rows; one still inside the restore window is kept and
 * restorable; an open legal hold leaves the field (and its values) soft-deleted until it lifts.
 *
 * Every hold case is two-sided: the same field is purged once the hold is lifted, so a passing
 * "retained" assertion cannot mean "nothing matched".
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { restoreField } from "../../apps/api/src/custom-field/repository";
import {
  CUSTOM_FIELD_RESTORE_WINDOW_DAYS,
  CUSTOM_FIELD_RESTORE_WINDOW_MS,
} from "../../apps/api/src/custom-field/retention";
import db, { schema } from "../../apps/api/src/database";
import {
  customFieldTable,
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../../apps/api/src/database/migration-schema";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../apps/api/src/scheduler";
import {
  CUSTOM_FIELD_PURGE_JOB,
  purgeSoftDeletedCustomFields,
  runCustomFieldPurgeJob,
} from "../../apps/api/src/scheduler/custom-field-purge";
import { buildTenant, type Tenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";
import { makeCustomField, setCustomValue } from "./helpers/p4-closeout";

const DAY_MS = 24 * 60 * 60 * 1000;

async function deletedField(t: Tenant, key: string, ageDays: number) {
  const field = await makeCustomField(t.workspaceId, t.type.id, {
    key,
    format: "text",
  });
  await setCustomValue(
    t.workspaceId,
    field.id,
    { id: t.workItem.id, projectId: t.workItem.projectId },
    `value of ${key}`,
  );
  await db
    .update(customFieldTable)
    .set({ deletedAt: new Date(Date.now() - ageDays * DAY_MS) })
    .where(eq(customFieldTable.id, field.id));
  return field;
}

async function fieldExists(id: string) {
  return (
    (
      await db
        .select({ id: customFieldTable.id })
        .from(customFieldTable)
        .where(eq(customFieldTable.id, id))
    ).length === 1
  );
}

async function valueCount(fieldId: string) {
  return (
    await db
      .select({ id: customFieldValueTable.id })
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.customFieldId, fieldId))
  ).length;
}

async function visibilityCount(fieldId: string) {
  return (
    await db
      .select({ id: customFieldTypeVisibilityTable.customFieldId })
      .from(customFieldTypeVisibilityTable)
      .where(eq(customFieldTypeVisibilityTable.customFieldId, fieldId))
  ).length;
}

async function placeHold(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy: "integration-test",
        reason: "custom field purge test",
      })
      .returning(),
    "placeHold",
  );
}

async function liftHold(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "integration-test" })
    .where(eq(schema.legalHoldTable.id, id));
}

async function workspaceOrganisation(t: Tenant) {
  return requireRow(
    await db
      .select({ organisationId: schema.workspaceTable.organisationId })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, t.workspaceId)),
    "workspace organisation",
  ).organisationId;
}

describe("custom-field-purge (CF-8)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("uses the same 30 day window as restore", () => {
    expect(CUSTOM_FIELD_RESTORE_WINDOW_DAYS).toBe(30);
    expect(CUSTOM_FIELD_RESTORE_WINDOW_MS).toBe(30 * DAY_MS);
  });

  it("purges a field past the window with its values and visibility, keeps one inside it, never a live one", async () => {
    const t = await buildTenant("cf-purge");
    const old = await deletedField(t, "old_field", 31);
    const recent = await deletedField(t, "recent_field", 29);
    const live = await makeCustomField(t.workspaceId, t.type.id, {
      key: "live_field",
      format: "text",
    });
    await setCustomValue(
      t.workspaceId,
      live.id,
      { id: t.workItem.id, projectId: t.workItem.projectId },
      "live value",
    );
    expect(await valueCount(old.id)).toBe(1);
    expect(await visibilityCount(old.id)).toBe(1);

    const outcome = await purgeSoftDeletedCustomFields();

    expect(outcome).toMatchObject({ purged: 1, valuesDeleted: 1, failed: 0 });
    expect(outcome.degraded).toBe(false);
    expect(await fieldExists(old.id)).toBe(false);
    expect(await valueCount(old.id)).toBe(0);
    expect(await visibilityCount(old.id)).toBe(0);
    expect(await fieldExists(recent.id)).toBe(true);
    expect(await valueCount(recent.id)).toBe(1);
    expect(await fieldExists(live.id)).toBe(true);
    expect(await valueCount(live.id)).toBe(1);

    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "custom_field.purged"));
    expect(audit).toMatchObject({
      actorType: "system",
      entityId: old.id,
      workspaceId: t.workspaceId,
    });
    expect(JSON.stringify(audit?.after)).not.toContain("value of");
  });

  it("restores a field inside the window and refuses one past it, so the two never disagree", async () => {
    const t = await buildTenant("cf-restore-window");
    const inside = await deletedField(t, "inside", 29);
    const outside = await deletedField(t, "outside", 31);
    const actor = { userId: "integration-test", actorType: "person" as const };

    const restored = await restoreField(inside.id, t.workspaceId, actor);
    expect(restored?.id).toBe(inside.id);
    await expect(
      restoreField(outside.id, t.workspaceId, actor),
    ).rejects.toMatchObject({ status: 409 });

    await purgeSoftDeletedCustomFields();
    expect(await fieldExists(inside.id)).toBe(true);
    expect(await fieldExists(outside.id)).toBe(false);
  });

  it("is idempotent", async () => {
    const t = await buildTenant("cf-idempotent");
    await deletedField(t, "gone_once", 45);
    expect((await purgeSoftDeletedCustomFields()).purged).toBe(1);
    expect(await purgeSoftDeletedCustomFields()).toMatchObject({
      purged: 0,
      failed: 0,
    });
  });

  it("retains a field under an organisation hold until the hold lifts", async () => {
    const t = await buildTenant("cf-org-hold");
    const field = await deletedField(t, "held_org", 40);
    const hold = await placeHold(
      "organisation",
      await workspaceOrganisation(t),
    );

    const held = await purgeSoftDeletedCustomFields();
    expect(held.purged).toBe(0);
    expect(await fieldExists(field.id)).toBe(true);
    expect(await valueCount(field.id)).toBe(1);

    await liftHold(hold.id);
    expect((await purgeSoftDeletedCustomFields()).purged).toBe(1);
    expect(await fieldExists(field.id)).toBe(false);
  });

  it("retains a field whose value sits on a work item of a held person until the hold lifts", async () => {
    const t = await buildTenant("cf-person-hold");
    const field = await deletedField(t, "held_person", 40);
    const hold = await placeHold("person", t.requesterPerson.id);

    expect((await purgeSoftDeletedCustomFields()).purged).toBe(0);
    expect(await fieldExists(field.id)).toBe(true);

    await liftHold(hold.id);
    expect((await purgeSoftDeletedCustomFields()).purged).toBe(1);
    expect(await fieldExists(field.id)).toBe(false);
  });

  it("P4R1-M6: the hold scope follows the work item's live project, not the value's stale project_id", async () => {
    const t = await buildTenant("cf-moved-hold");
    const field = await deletedField(t, "held_moved", 40);
    // The value row keeps the project it was written under (a stale, unheld project) while the
    // item now lives in a project of another organisation, which is placed under hold.
    const otherOrg = `moved-org-${t.workspaceId}`;
    await db.insert(schema.organisationTable).values({
      id: otherOrg,
      key: otherOrg,
      name: "Moved org",
      isInternal: false,
      portalAccess: true,
    });
    const { project: stale } = await createProjectFixture({
      workspaceId: t.workspaceId,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: otherOrg })
      .where(eq(schema.projectTable.id, t.workItem.projectId));
    await db
      .update(customFieldValueTable)
      .set({ projectId: stale.id })
      .where(eq(customFieldValueTable.customFieldId, field.id));
    const hold = await placeHold("organisation", otherOrg);

    expect((await purgeSoftDeletedCustomFields()).purged).toBe(0);
    expect(await fieldExists(field.id)).toBe(true);
    expect(await valueCount(field.id)).toBe(1);

    await liftHold(hold.id);
    expect((await purgeSoftDeletedCustomFields()).purged).toBe(1);
    expect(await fieldExists(field.id)).toBe(false);
  });

  it("runs as the registered, leased job", async () => {
    const t = await buildTenant("cf-job");
    const field = await deletedField(t, "by_job", 40);
    initializeScheduler();
    try {
      const job = registeredJobByName(CUSTOM_FIELD_PURGE_JOB);
      expect(job).toBeDefined();
      expect(job?.getPattern()).toBe("45 3 * * *");
    } finally {
      shutdownScheduler();
    }
    const outcome = await runCustomFieldPurgeJob();
    expect(outcome).toMatchObject({ status: "purged", purged: 1 });
    expect(await fieldExists(field.id)).toBe(false);
  });
});
