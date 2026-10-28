/**
 * P4R1-L8: the non-compliant report must list items that really lack a value even when the first
 * items (in project and number order) are compliant; the old report scanned limit*4 items by key
 * and understated the gap.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getField,
  nonCompliantItems,
} from "../../apps/api/src/custom-field/repository";
import db, { schema } from "../../apps/api/src/database";
import { customFieldTypeVisibilityTable } from "../../apps/api/src/database/migration-schema";
import { buildTenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { makeCustomField, setCustomValue } from "./helpers/p4-closeout";

describe("custom field non-compliant items", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("fills the page with items lacking a value, past compliant and blank-valued ones", async () => {
    const t = await buildTenant("cf-noncompliant");
    const field = await makeCustomField(t.workspaceId, t.type.id, {
      key: "owner_ref",
      format: "text",
    });
    await db
      .update(customFieldTypeVisibilityTable)
      .set({ required: true })
      .where(
        and(
          eq(customFieldTypeVisibilityTable.customFieldId, field.id),
          eq(customFieldTypeVisibilityTable.workItemTypeId, t.type.id),
        ),
      );
    const item = async (number: number) =>
      (
        await db
          .insert(schema.workItemTable)
          .values({
            workspaceId: t.workspaceId,
            projectId: t.workItem.projectId,
            typeId: t.type.id,
            stateId: t.workItem.stateId,
            title: `Item ${number}`,
            number,
            key: `NC-${randomUUID().slice(0, 8)}`,
          })
          .returning()
      )[0] as { id: string; projectId: string; key: string };

    // t.workItem (number 1) has no value. Items 1001-1008 are compliant, 1009 has a blank string,
    // 1010 has no value.
    for (let n = 1001; n <= 1008; n++) {
      const row = await item(n);
      await setCustomValue(t.workspaceId, field.id, row, `value ${n}`);
    }
    const blank = await item(1009);
    await setCustomValue(t.workspaceId, field.id, blank, "   ");
    const missing = await item(1010);

    const materialized = await getField(field.id, t.workspaceId);
    if (!materialized) throw new Error("field missing");
    const all = await nonCompliantItems(
      materialized,
      t.workspaceId,
      [t.workItem.projectId],
      50,
    );
    expect(all.map((row) => row.id).sort()).toEqual(
      [t.workItem.id, blank.id, missing.id].sort(),
    );

    // limit 1 with 8 compliant items in front of the later gaps: still finds one.
    const one = await nonCompliantItems(
      materialized,
      t.workspaceId,
      [t.workItem.projectId],
      1,
    );
    expect(one).toHaveLength(1);
  });
});
