import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyWorkItemFieldValues,
  createField,
  listFields,
  reorderFields,
  updateField,
} from "../../apps/api/src/custom-field/repository";
import db from "../../apps/api/src/database";
import {
  customFieldTable,
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../../apps/api/src/database/migration-schema";
import { buildTenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { makeCustomField } from "./helpers/p4-closeout";
import { waitForLockBlocker } from "./helpers/race-soft-delete";

describe("custom field definition validation locks", () => {
  beforeEach(resetTestDatabase);

  it("reorders fields while a value writer holds the lowest id without deadlocking", async () => {
    const t = await buildTenant("cf-reorder-race");
    // Heap and workspace/key index order oppose id order, exposing unordered row locks.
    const high = await makeCustomField(t.workspaceId, t.type.id, {
      key: "a_first",
      format: "text",
    });
    const low = { id: "0-reorder-field", key: "z_last" };
    await db.insert(customFieldTable).values({
      ...low,
      workspaceId: t.workspaceId,
      sectionId: high.sectionId,
      name: "Low field",
      format: "text",
    });
    await db.insert(customFieldTypeVisibilityTable).values({
      workspaceId: t.workspaceId,
      customFieldId: low.id,
      workItemTypeId: t.type.id,
      visible: true,
      required: false,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await observer.connect();
    let ready!: (pid: number) => void;
    const started = new Promise<number>((resolve) => {
      ready = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = db.transaction(async (tx) => {
      await tx
        .select({ id: customFieldTable.id })
        .from(customFieldTable)
        .where(eq(customFieldTable.id, low.id))
        .for("share");
      const result = await tx.execute<{ pid: number }>(
        sql`SELECT pg_backend_pid() AS pid`,
      );
      ready(result.rows[0]!.pid);
      await held;
      return applyWorkItemFieldValues(
        tx,
        t.workItem,
        { [low.key]: "low value", [high.key]: "high value" },
        { create: false, enforceRequired: false },
      );
    });
    let outcomes: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const pid = await started;
      const reorder = reorderFields(t.workspaceId, [
        { sectionId: high.sectionId, fieldIds: [high.id, low.id] },
      ]);
      outcomes = Promise.allSettled([writer, reorder]);
      expect(await waitForLockBlocker(observer, pid)).toBe(true);
    } finally {
      release();
      await (outcomes ?? Promise.allSettled([writer]));
      await observer.end();
    }
    expect(await outcomes).toEqual([
      expect.objectContaining({ status: "fulfilled" }),
      expect.objectContaining({ status: "fulfilled" }),
    ]);
    expect((await listFields(t.workspaceId)).map((field) => field.id)).toEqual([
      high.id,
      low.id,
    ]);
    const values = await db
      .select()
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.entityId, t.workItem.id));
    expect(values.map((row) => row.value).sort()).toEqual([
      "high value",
      "low value",
    ]);
  });

  it("holds the submitted definition until the value commits, preventing option removal", async () => {
    const t = await buildTenant("cf-definition-race");
    const field = await makeCustomField(t.workspaceId, t.type.id, {
      key: "region",
      format: "select",
      options: [
        { key: "east", label: "East" },
        { key: "west", label: "West" },
      ],
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await observer.connect();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready!: (pid: number) => void;
    const started = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const writer = db.transaction(async (tx) => {
      const result = await tx.execute<{ pid: number }>(
        sql`SELECT pg_backend_pid() AS pid`,
      );
      await applyWorkItemFieldValues(
        tx,
        t.workItem,
        { region: "east" },
        { create: false, enforceRequired: false },
      );
      ready(result.rows[0]!.pid);
      await held;
    });
    let editing: Promise<unknown> | undefined;
    try {
      const pid = await started;
      editing = updateField(
        field.id,
        t.workspaceId,
        { options: [{ key: "west", label: "West" }] },
        { userId: t.requester.user.id, actorType: "person" },
      ).catch((error: unknown) => error);
      expect(await waitForLockBlocker(observer, pid)).toBe(true);
    } finally {
      release();
      await writer;
      await observer.end();
    }
    expect(await editing).toMatchObject({ status: 409 });
    expect(
      (
        await db
          .select()
          .from(customFieldTable)
          .where(eq(customFieldTable.id, field.id))
      )[0]?.options,
    ).toEqual([
      { key: "east", label: "East" },
      { key: "west", label: "West" },
    ]);
  });
  it.each(["create", "update"] as const)(
    "%s waits for a controller edit before validating the dependent",
    async (operation) => {
      const t = await buildTenant("cf-controller-race");
      const root = await makeCustomField(t.workspaceId, t.type.id, {
        key: "root",
        format: "text",
      });
      const controller = await makeCustomField(t.workspaceId, t.type.id, {
        key: "controller",
        format: "text",
      });
      const dependent = await makeCustomField(t.workspaceId, t.type.id, {
        key: "dependent",
        format: "text",
      });
      const rival = new Client({
        connectionString: process.env.TASKDESK_DATABASE_URL,
      });
      await rival.connect();
      let pending: Promise<unknown> | undefined;
      try {
        await rival.query("BEGIN");
        await rival.query(
          "UPDATE custom_field SET visibility_condition = $1 WHERE id = $2",
          [
            JSON.stringify({ field_key: root.key, op: "is_set" }),
            controller.id,
          ],
        );
        const result = await rival.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        const condition = { field_key: controller.key, op: "is_set" };
        const actor = {
          userId: t.requester.user.id,
          actorType: "person" as const,
        };
        pending = (
          operation === "update"
            ? updateField(
                dependent.id,
                t.workspaceId,
                { visibilityCondition: condition },
                actor,
              )
            : createField({
                workspaceId: t.workspaceId,
                sectionId: dependent.sectionId,
                key: "new_dependent",
                name: "New dependent",
                format: "text",
                options: [],
                visibilityCondition: condition,
                actor,
              })
        ).catch((error: unknown) => error);
        expect(await waitForLockBlocker(rival, result.rows[0]!.pid)).toBe(true);
      } finally {
        await rival.query("COMMIT");
        await rival.end();
      }
      expect(await pending).toMatchObject({
        status: 400,
        message: "A controlling field may not itself be conditional",
      });
    },
  );
});
