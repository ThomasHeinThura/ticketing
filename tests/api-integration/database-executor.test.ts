/**
 * #580 batch 0: a repository-style function that takes an `Executor` really runs on the
 * handle it is given, so a statement made on a transaction is invisible outside it until
 * commit and disappears on rollback.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  type Executor,
  executorOrDefault,
} from "../../apps/api/src/database/executor";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function insertName(
  workspaceId: string,
  createdBy: string,
  name: string,
  executor?: Executor,
) {
  const [row] = await executorOrDefault(executor)
    .insert(schema.cannedResponseTable)
    .values({ workspaceId, name, body: {}, createdBy })
    .returning();
  return row;
}

async function countNamed(name: string, executor?: Executor) {
  const rows = await executorOrDefault(executor)
    .select({ id: schema.cannedResponseTable.id })
    .from(schema.cannedResponseTable)
    .where(eq(schema.cannedResponseTable.name, name));
  return rows.length;
}

describe("API integration: Executor passes a transaction handle through", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a write on the transaction is visible to it, hidden outside, and rolled back with it", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const rollback = new Error("rollback");

    await expect(
      db.transaction(async (tx) => {
        await insertName(member.workspace.id, member.user.id, "in-tx", tx);
        expect(await countNamed("in-tx", tx)).toBe(1);
        expect(await countNamed("in-tx")).toBe(0);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    expect(await countNamed("in-tx")).toBe(0);
  });

  it("a committed transaction write is visible on the shared connection; no handle uses it", async () => {
    const member = await createWorkspaceMember({ role: "admin" });

    await db.transaction(async (tx) => {
      await insertName(member.workspace.id, member.user.id, "committed", tx);
    });
    await insertName(member.workspace.id, member.user.id, "direct");

    expect(await countNamed("committed")).toBe(1);
    expect(await countNamed("direct")).toBe(1);
  });
});
