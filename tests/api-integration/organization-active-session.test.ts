import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

// R2 (retrofit plan §4): session.active_organization_id
// (apps/api/src/database/schema.ts:61) is populated ONLY inside the
// `hooks.after` middleware on the sign-up/sign-in paths --
// apps/api/src/auth.ts:780-800 (the write itself at :792-796). An existing
// session never re-acquires it: this hook only ever runs on
// "/sign-up*"/"/sign-in*" requests (the ctx.path.startsWith check at
// auth.ts:781), never as a side effect of workspace membership changing
// later (e.g. an invite getting accepted, or a direct DB seed).
//
// This is a genuinely HTTP-level, database-state characterization: it does
// not need mocking, and it pins exactly the behavior the retrofit plan
// warns about -- if a native replacement for useActiveOrganization() drops
// this backfill, an already-signed-in user lands with no active workspace
// and no error (plan §4, R2).
//
// UNRUN: no PostgreSQL is available in this environment; see the report for
// how this was verified by reading the source instead.
describe("R2: session.active_organization_id is set only at sign-in/sign-up (auth.ts:780-800)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("does not retroactively set activeOrganizationId on a session that predates the membership, but a fresh sign-in does", async () => {
    const { app } = createApp();
    const email = `late-joiner-${randomUUID()}@example.com`;
    const password = "correct horse battery staple";

    // First sign-up: no workspace exists yet, so the after-hook
    // (auth.ts:784-789) finds no workspace_member row for this user and
    // leaves activeOrganizationId null on this session (the `if
    // (activeWorkspaceId)` guard at auth.ts:792 never runs the UPDATE).
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
    // fires again on "/sign-in/email" (auth.ts:781) and this time finds
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
