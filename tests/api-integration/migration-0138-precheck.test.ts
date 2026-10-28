import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// P4R1-M4: migration 0138 must refuse unsafe data instead of silently deleting duplicate
// team_member rows or un-flagging CAB teams. The precheck block is run against live-shaped data
// (the two unique indexes dropped inside a rolled-back transaction so violating rows can exist).
const precheck = (() => {
  const file = readFileSync(
    resolve(__dirname, "../../apps/api/drizzle/0138_team_governance.sql"),
    "utf8",
  );
  const start = file.indexOf("DO $$");
  const end = file.indexOf("$$;", start) + 3;
  return file.slice(start, end).replace(/;$/u, "");
})();

class Rollback extends Error {}

async function inViolatingTx(
  seed: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<void>,
) {
  let message: string | null = null;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP INDEX "team_member_team_user_unique"`);
      await tx.execute(sql`DROP INDEX "team_workspace_cab_unique"`);
      await seed(tx);
      try {
        await tx.execute(sql.raw(`SAVEPOINT p; ${precheck}`));
      } catch (error) {
        message = String((error as { cause?: Error }).cause?.message ?? error);
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return message;
}

describe("migration 0138 precheck", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("passes on clean data", async () => {
    const message = await inViolatingTx(async () => {});
    expect(message).toBeNull();
  });

  it("refuses duplicate team_member rows and leaves them untouched", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const message = await inViolatingTx(async (tx) => {
      await tx.execute(
        sql`INSERT INTO "team" ("id", "name", "workspace_id", "created_at") VALUES ('t1', 'Ops', ${workspace.id}, now())`,
      );
      for (const id of ["m1", "m2"])
        await tx.execute(
          sql`INSERT INTO "team_member" ("id", "team_id", "user_id", "created_at") VALUES (${id}, 't1', ${user.id}, now())`,
        );
    });
    expect(message).toContain("duplicate team_member rows");
  });

  it("refuses more than one CAB team per workspace", async () => {
    const { workspace } = await createWorkspaceMember();
    const message = await inViolatingTx(async (tx) => {
      for (const id of ["t1", "t2"])
        await tx.execute(
          sql`INSERT INTO "team" ("id", "name", "workspace_id", "is_cab", "created_at") VALUES (${id}, ${id}, ${workspace.id}, true, now())`,
        );
    });
    expect(message).toContain("more than one CAB team");
  });

  it("the migration no longer deletes or un-flags anything itself", () => {
    const file = readFileSync(
      resolve(__dirname, "../../apps/api/drizzle/0138_team_governance.sql"),
      "utf8",
    );
    expect(file).not.toMatch(/DELETE FROM "team_member"/u);
    expect(file).not.toMatch(/UPDATE "team" SET "is_cab"/u);
  });
});
