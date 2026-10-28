import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  createRequestType,
  updateRequestType,
} from "../../apps/api/src/intake/repository";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

// RT-0: the key is an opaque server-generated identifier, independent of the name and the
// primary key, and a rename never changes it.
describe("request type key (RT-0)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("is generated independently of name and id, and survives a rename", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const workspaceId = admin.workspace.id;
    const workflow = requireRow(
      await db
        .insert(schema.workflowTable)
        .values({ workspaceId, key: randomUUID(), name: "RT-0" })
        .returning(),
      "workflow",
    );
    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId,
          key: randomUUID(),
          name: "Request",
          category: "service",
          workflowId: workflow.id,
        })
        .returning(),
      "type",
    );
    const input = {
      workspaceId,
      name: "Laptop Request",
      description: null,
      icon: null,
      group: "Hardware",
      workItemTypeId: type.id,
      defaultProjectId: null,
      formSchema: { fields: [] },
      slaPolicyId: null,
      defaultAssigneeId: null,
      autoAccept: false,
      customerVisible: false,
      forcePrivate: false,
      position: 0,
    };
    const first = await createRequestType(input, admin.user.id);
    const second = await createRequestType(input, admin.user.id);

    expect(first.key).not.toBe(second.key);
    expect(first.key).not.toBe(first.id);
    expect(first.key.toLowerCase()).not.toContain("laptop");

    const renamed = await updateRequestType(
      first.id,
      { name: "Notebook Request" },
      first.version,
      admin.user.id,
    );
    expect(renamed.name).toBe("Notebook Request");
    expect(renamed.key).toBe(first.key);
    const [stored] = await db
      .select({ key: schema.requestTypeTable.key })
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, first.id));
    expect(stored?.key).toBe(first.key);
  });
});
