import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

describe("pending_action durable schema", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("stores one pending action for sorted requester/action/target identity", async () => {
    const id = randomUUID();
    const row = {
      id,
      requestedByPersonId: `person-${id}`,
      credentialType: "session",
      credentialId: `session-${id}`,
      origin: "web",
      action: "delete",
      targetType: "work_item",
      targetIds: ["SUP-1", "SUP-2"],
      payload: { target_ids: ["SUP-1", "SUP-2"] },
      routeKey: "DELETE /api/work-items/{key}",
      payloadHash: "a".repeat(64),
      payloadSummary: { title: "Two work items" },
      confirmationRequired: "click",
      state: "pending",
      traceId: `trace-${id}`,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await db.insert(schema.pendingActionTable).values([row]);
    await expect(
      db.insert(schema.pendingActionTable).values([
        {
          ...row,
          id: `${id}-duplicate`,
        },
      ]),
    ).rejects.toThrow();

    const stored = await db
      .select({ id: schema.pendingActionTable.id })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, id));
    expect(stored).toEqual([{ id }]);
  });

  it("rejects unsupported states and malformed payload hashes at the database boundary", async () => {
    const id = randomUUID();
    const base = {
      id,
      requestedByPersonId: `person-${id}`,
      credentialType: "session",
      origin: "web",
      action: "delete",
      targetType: "project",
      targetIds: ["project-1"],
      payload: {},
      routeKey: "DELETE /api/project/{id}",
      payloadHash: "a".repeat(64),
      payloadSummary: {},
      confirmationRequired: "typed_name_step_up",
      traceId: `trace-${id}`,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await expect(
      db.insert(schema.pendingActionTable).values([
        {
          ...base,
          state: "complete",
        },
      ]),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.pendingActionTable).values([
        {
          ...base,
          id: `${id}-bad-hash`,
          payloadHash: "not-a-sha256",
        },
      ]),
    ).rejects.toThrow();
  });
});
