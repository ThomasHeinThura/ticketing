import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  signUpUser,
} from "./helpers/organization-http";

// A1-P10: S2 is READ ONLY. None of the four new routes may write anything,
// anywhere -- not a new row in any of the 29 public tables, and not a
// mutation of the calling session's active_organization_id/active_team_id
// columns. This is the negative half of the S2 contract: the frozen S1
// oracle (tests/api-integration/organization-*.test.ts) proves the
// characterized plugin behavior is untouched; this file proves the NEW
// routes added alongside it introduce no side effect of their own.

// Local, read-only re-derivation of the S1 oracle's "whole-database
// enumeration" method (organization-plugin-characterization.test.ts's own
// comment block, §2.5 of the retrofit plan) -- queried fresh here rather
// than imported, since neither
// tests/api-integration/helpers/database.ts nor
// tests/api-integration/helpers/organization-http.ts may be modified by
// this lane, and this file only ever reads the catalog, never touches
// either of those.
async function snapshotAllTableCounts(): Promise<Record<string, number>> {
  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const counts: Record<string, number> = {};
  for (const { table_name: tableName } of tables.rows) {
    const result = await db.execute<{ count: string }>(
      sql.raw(`SELECT count(*) AS count FROM "${tableName}"`),
    );
    counts[tableName] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("the S2 native read routes write nothing (A1-P10)", () => {
  it("leaves every one of the 29 public tables' row counts unchanged, and the session's active workspace/team untouched", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    await inviteAndAcceptAsNewMember(app, owner.cookie, workspace.id, "admin");
    await app.request("/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
        "x-forwarded-for": "198.51.100.250",
      },
      body: JSON.stringify({
        organizationId: workspace.id,
        email: "still-pending@example.com",
        role: "viewer",
      }),
    });
    // Seeded BEFORE the snapshot: signing up is itself a write (user,
    // account, session), and this user exists only to drive the 403 path
    // below -- it must not be mistaken for a side effect of a read route.
    const otherUser = await signUpUser(app);

    // A meaningful table count to sanity-check the snapshot mechanism
    // itself isn't a no-op (it must be > 0, or the diff below is vacuous).
    const before = await snapshotAllTableCounts();
    expect(Object.keys(before).length).toBeGreaterThanOrEqual(29);
    expect(before.workspace).toBeGreaterThan(0);

    const [sessionBefore] = await db
      .select({
        activeOrganizationId: schema.sessionTable.activeOrganizationId,
        activeTeamId: schema.sessionTable.activeTeamId,
      })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, owner.user.id))
      .limit(1);

    // Every new S2 route, exercised once each, as the real member.
    await app.request("/api/workspace", {
      headers: { cookie: owner.cookie },
    });
    await app.request(`/api/workspace/${workspace.id}`, {
      headers: { cookie: owner.cookie },
    });
    await app.request(`/api/workspace/${workspace.id}/invitations`, {
      headers: { cookie: owner.cookie },
    });
    await app.request(`/api/capabilities?workspaceId=${workspace.id}`, {
      headers: { cookie: owner.cookie },
    });
    // And once more as an unprivileged 403 path, since a refused request
    // must be just as inert as an allowed one.
    await app.request(`/api/workspace/${workspace.id}`, {
      headers: { cookie: otherUser.cookie },
    });

    const after = await snapshotAllTableCounts();
    expect(after).toEqual(before);

    const [sessionAfter] = await db
      .select({
        activeOrganizationId: schema.sessionTable.activeOrganizationId,
        activeTeamId: schema.sessionTable.activeTeamId,
      })
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, owner.user.id))
      .limit(1);

    expect(sessionAfter?.activeOrganizationId).toBe(
      sessionBefore?.activeOrganizationId,
    );
    expect(sessionAfter?.activeTeamId).toBe(sessionBefore?.activeTeamId);
  });
});
