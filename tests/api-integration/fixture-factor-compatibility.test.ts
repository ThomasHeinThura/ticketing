import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

describe("authenticated workspace member fixture", () => {
  it("creates an initialized instance and active staff identity", async () => {
    const { user } = await createWorkspaceMember();
    const [instance] = await db
      .select({
        setupCompletedAt: schema.instanceSettingTable.setupCompletedAt,
        localFactorPolicy: schema.instanceSettingTable.localFactorPolicy,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const [person] = await db
      .select({
        side: schema.personTable.side,
        active: schema.personTable.active,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));

    expect(instance?.setupCompletedAt).toBeInstanceOf(Date);
    expect(instance?.localFactorPolicy).toEqual({
      mode: "optional",
      requiredRoleId: null,
    });
    expect(person).toEqual({ side: "staff", active: true });
  });

  it("preserves an explicitly configured factor policy", async () => {
    const policy = { mode: "required_staff", requiredRoleId: null };
    await db.insert(schema.instanceSettingTable).values({
      id: "singleton",
      localFactorPolicy: policy,
    });

    const { user } = await createWorkspaceMember();
    const [instance] = await db
      .select({
        localFactorPolicy: schema.instanceSettingTable.localFactorPolicy,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const [person] = await db
      .select({ active: schema.personTable.active })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));

    expect(instance?.localFactorPolicy).toEqual(policy);
    expect(person?.active).toBe(true);
  });
});
