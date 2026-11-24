/**
 * Issue #181 -- database backstops for membership and role integrity (migration 0227).
 *
 * Each rejected write below is a row the application-level guards already refuse; this proves
 * the database refuses it too. The preflight test runs the migration's own first statement, read
 * from the file that ships, against a row planted by dropping one constraint.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

const run = (statement: ReturnType<typeof sql>) => db.execute(statement);

/** drizzle wraps the driver error; the SQLSTATE and message live on `cause`. */
async function failure(statement: ReturnType<typeof sql>) {
  try {
    await run(statement);
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    return { code: cause?.code, message: cause?.message ?? "" };
  }
  throw new Error("expected the statement to be rejected");
}

async function seed() {
  await run(
    sql`INSERT INTO organisation (id, key, name) VALUES ('org1', 'org1', 'Org 1')`,
  );
  await run(
    sql`INSERT INTO person (id, organisation_id, side) VALUES ('staff1', 'org1', 'staff')`,
  );
  // An import placeholder (unclaimed claim row) and a SCIM-provisioned one (no claim row).
  await run(
    sql`INSERT INTO person (id, organisation_id, side, is_placeholder) VALUES ('ghost1', 'org1', 'staff', true), ('scim1', 'org1', 'staff', true)`,
  );
  await run(
    sql`INSERT INTO workspace (id, organisation_id, name, slug, created_at) VALUES ('ws1', 'org1', 'WS', 'ws1', now())`,
  );
  await run(
    sql`INSERT INTO import_run (id, workspace_id, plugin_id, source_ref, started_by, state) VALUES ('run1', 'ws1', 'import.mcp', 'src', 'staff1', 'completed')`,
  );
  await run(
    sql`INSERT INTO import_placeholder_claim (person_id, import_run_id, normalized_email) VALUES ('ghost1', 'run1', 'g@example.test')`,
  );
  await run(
    sql`INSERT INTO role (id, scope, key, name, rank) VALUES ('role_ws', 'workspace', 'g181-ws', 'WS', 10)`,
  );
}

const insertMembership = (person: string, scope: string, role = "role_ws") =>
  sql`INSERT INTO membership (id, person_id, scope, scope_id, role_id) VALUES (${`m_${person}_${scope}`}, ${person}, ${scope}, 'scope1', ${role})`;

beforeEach(async () => {
  await resetTestDatabase();
  await seed();
});

describe("#181 membership and role guards", () => {
  it("accepts a legitimate staff membership", async () => {
    await run(insertMembership("staff1", "workspace"));
    const rows = await run(
      sql`SELECT 1 FROM membership WHERE person_id = 'staff1'`,
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("S3: rejects a membership whose scope differs from its role scope", async () => {
    const error = await failure(insertMembership("staff1", "project"));
    expect(error.code).toBe("23503");
    expect(error.message).toContain("membership_role_scope_fk");
  });

  it("S3: a role scope change cascades, so scopes never diverge", async () => {
    await run(insertMembership("staff1", "workspace"));
    await run(sql`UPDATE role SET scope = 'project' WHERE id = 'role_ws'`);
    const rows = await run(
      sql`SELECT scope FROM membership WHERE person_id = 'staff1'`,
    );
    expect(rows.rows).toEqual([{ scope: "project" }]);
  });

  it("S5: rejects values outside the closed vocabularies", async () => {
    expect(
      (
        await failure(
          sql`INSERT INTO person (id, organisation_id, side) VALUES ('p2', 'org1', 'both')`,
        )
      ).message,
    ).toContain("person_side_check");
    expect(
      (
        await failure(
          sql`INSERT INTO role (id, scope, key, name, rank) VALUES ('r2', 'team', 'k', 'n', 1)`,
        )
      ).message,
    ).toContain("role_scope_check");
    expect(
      (
        await failure(
          sql`UPDATE organisation SET default_customer_visibility = 'public'`,
        )
      ).message,
    ).toContain("organisation_default_customer_visibility_check");
    expect(
      (
        await failure(
          sql`INSERT INTO membership (id, person_id, scope, scope_id, role_id) VALUES ('m2', 'staff1', 'team', 's', 'role_ws')`,
        )
      ).code,
    ).toBe("23514");
  });

  it("S6: an import placeholder cannot hold a membership", async () => {
    const error = await failure(insertMembership("ghost1", "workspace"));
    expect(error.code).toBe("23514");
    expect(error.message).toContain("placeholder");
  });

  it("S6: a SCIM-provisioned placeholder may hold a group-mapped membership", async () => {
    await run(insertMembership("scim1", "workspace"));
  });

  it("S6: a membership cannot be moved onto a placeholder person", async () => {
    await run(insertMembership("staff1", "workspace"));
    const error = await failure(
      sql`UPDATE membership SET person_id = 'ghost1'`,
    );
    expect(error.code).toBe("23514");
  });

  it("S6: a person holding a membership cannot become a placeholder", async () => {
    await run(insertMembership("staff1", "workspace"));
    const error = await failure(
      sql`UPDATE person SET is_placeholder = true WHERE id = 'staff1'`,
    );
    expect(error.code).toBe("23514");
  });

  it("S6: an unclaimed claim cannot be added or reopened for a person holding a membership", async () => {
    await run(insertMembership("scim1", "workspace"));
    const added = await failure(
      sql`INSERT INTO import_placeholder_claim (person_id, import_run_id, normalized_email) VALUES ('scim1', 'run1', 's@example.test')`,
    );
    expect(added.code).toBe("23514");
    await run(insertMembership("staff1", "workspace"));
    await run(
      sql`INSERT INTO import_placeholder_claim (person_id, import_run_id, normalized_email, claimed_at) VALUES ('staff1', 'run1', 'c@example.test', now())`,
    );
    const reopened = await failure(
      sql`UPDATE import_placeholder_claim SET claimed_at = NULL WHERE person_id = 'staff1'`,
    );
    expect(reopened.code).toBe("23514");
  });

  it("S6: a concurrent membership and unclaimed claim cannot both commit", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const membership = db.transaction(async (tx) => {
      await tx.execute(insertMembership("scim1", "workspace"));
      await gate;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const claim = failure(
      sql`INSERT INTO import_placeholder_claim (person_id, import_run_id, normalized_email) VALUES ('scim1', 'run1', 's@example.test')`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await membership;
    expect((await claim).code).toBe("23514");
  });

  it("preflight: refuses loudly and names the bad row", async () => {
    const source = await readFile(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../apps/api/drizzle/0227_p4c_membership_role_guards.sql",
      ),
      "utf8",
    );
    const preflight = source.split("--> statement-breakpoint")[0] ?? "";
    expect(preflight).toContain("#181 preflight");
    await run(sql`ALTER TABLE person DROP CONSTRAINT person_side_check`);
    try {
      await run(
        sql`INSERT INTO person (id, organisation_id, side) VALUES ('bad_side', 'org1', 'both')`,
      );
      const error = await failure(sql.raw(preflight));
      expect(error.message).toContain("person.side");
      expect(error.message).toContain("bad_side");
    } finally {
      await run(sql`DELETE FROM person WHERE id = 'bad_side'`);
      await run(
        sql`ALTER TABLE person ADD CONSTRAINT person_side_check CHECK (side = ANY (ARRAY['staff'::text, 'customer'::text]))`,
      );
    }
  });
});
