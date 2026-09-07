import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

// R2 (retrofit plan §4): session.active_organization_id
// (apps/api/src/database/schema.ts:61).
//
// CORRECTED BY F11. An earlier version of this comment, and this describe
// block's own title, said the column is populated ONLY at sign-in/sign-up.
// That is false, and the create path is the counter-example: better-auth's
// createOrganization also sets it, on the CREATING session, which the create
// oracle in organization-plugin-characterization.test.ts now pins as the
// seventh side effect. There are three distinct behaviours and this file
// characterizes the middle one:
//
//   CREATE                  -- the creating session gets the new workspace
//                              selected, in the same request.
//   LATER MEMBERSHIP INSERT -- an already-existing session is NOT
//                              retroactively backfilled just because a
//                              workspace membership appears. THIS FILE.
//   FRESH SIGN-IN           -- a new session can select an available
//                              workspace, per the hooks.after middleware.
//
// So: populated by the `hooks.after` middleware on the sign-up/sign-in paths
// when applicable -- apps/api/src/auth.ts:713-733, the write at :726-730,
// gated by the ctx.path.startsWith check at auth.ts:~713 -- AND during
// organization creation for the creating session. What it is NOT is
// retroactive: no existing session re-acquires it as a side effect of
// workspace membership changing later (an invite accepted, or a direct DB
// seed). That non-retroactivity is what the test below proves, and it is
// unchanged.
//
// This is a genuinely HTTP-level, database-state characterization: it does
// not need mocking, and it pins exactly the behavior the retrofit plan
// warns about -- if a native replacement for useActiveOrganization() drops
// this backfill, an already-signed-in user lands with no active workspace
// and no error (plan §4, R2).
//
// EXECUTED. These assertions run against a real PostgreSQL 18: the independent
// review of bc8a749 reproduced them green, and the F1-F10 remediation pass
// re-ran them on a freshly created database. The claim this replaces --
// "UNRUN: no PostgreSQL is available in this environment; see the report for
// how this was verified by reading the source instead" -- was false at that
// HEAD, and is corrected rather than quietly dropped: the most security-
// sensitive files in the suite were telling their next reader that nothing in
// them had ever run.
describe("R2: session.active_organization_id is NOT retroactively backfilled into an existing session (auth.ts:713-733)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("does not retroactively set activeOrganizationId on a session that predates the membership, but a fresh sign-in does", async () => {
    const { app } = createApp();
    const email = `late-joiner-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";

    // First sign-up: no workspace exists yet, so the after-hook
    // (auth.ts:~716-728) finds no workspace_member row for this user and
    // leaves activeOrganizationId null on this session. The `if
    // (activeWorkspaceId)` guard is auth.ts:725 and never runs the UPDATE that
    // follows at :726-729 -- :728 is that update's .set(), not the guard.
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: "Late Joiner" }),
    });
    expect(signUp.status).toBe(200);
    const { user } = (await signUp.json()) as { user: { id: string } };

    const [firstSession] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id));
    if (!firstSession) throw new Error("expected a session row after sign-up");
    expect(firstSession.activeOrganizationId).toBeNull();

    // Now add the user to a workspace *after* the session already exists
    // -- seeded directly here, but equivalent to an invite being accepted
    // later in the same session's lifetime.
    const workspaceId = `workspace-${randomUUID()}`;
    await db.insert(schema.workspaceTable).values({
      id: workspaceId,
      name: "Joined Late",
      slug: `joined-late-${randomUUID()}`,
      createdAt: new Date(),
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: user.id,
      role: "member",
      joinedAt: new Date(),
    });

    // Re-read the EXISTING session: it must not have picked up the new
    // membership. This is R2.
    const [stillFirstSession] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, firstSession.id));
    expect(stillFirstSession?.activeOrganizationId).toBeNull();

    // A NEW sign-in, however, does pick it up: auth.ts's `hooks.after`
    // fires again on "/sign-in/email" (auth.ts:~713) and this time finds
    // the now-existing workspace_member row.
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(signIn.status).toBe(200);

    const [secondSession] = await db
      .select()
      .from(schema.sessionTable)
      .where(
        and(
          eq(schema.sessionTable.userId, user.id),
          ne(schema.sessionTable.id, firstSession.id),
        ),
      );
    expect(secondSession).toBeDefined();
    expect(secondSession?.activeOrganizationId).toBe(workspaceId);

    // ...and the first session is still untouched by the second sign-in.
    const [firstSessionAfterSecondSignIn] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, firstSession.id));
    expect(firstSessionAfterSecondSignIn?.activeOrganizationId).toBeNull();
  });
});
