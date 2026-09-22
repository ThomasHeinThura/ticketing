/**
 * #23's mandatory Opus security review of PR #261, F1's delta-confirmation pass
 * (D1, 2026-09-22, "F1 itself is not closed: the slug namespace is transient, the
 * key-claim namespace is permanent").
 *
 * `project_slug_unique` (migration 0064, `project-slug-unique.test.ts`) only constrains
 * the set of slugs held by rows CURRENTLY in `project`. It says nothing about a slug that
 * *used to* be held -- and `work_item_key_claim` never releases a key claim, by design.
 * So a slug that is freed (by renaming the project that holds it, or by hard-deleting its
 * workspace) could still be handed to an unrelated later tenant, who then collides on a
 * key range the first holder already burned. D1 reproduced this live, twice, against the
 * migration-0064-only fix.
 *
 * `project_slug_claim` (migration 0065) closes this the same way `work_item_key_claim`
 * closes the analogous gap on keys: once a slug is claimed, by any project, it is claimed
 * forever, independent of what later happens to the project that claimed it. These tests
 * reproduce D1's two release paths against the reviewed-and-fixed head and confirm each is
 * now blocked -- as a clean 409 at PROJECT CREATION, before a colliding work item is ever
 * attempted, not merely caught later as a 500 on work-item create.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

function createProjectRequest(
  app: ReturnType<typeof createApp>["app"],
  body: Record<string, unknown>,
) {
  return app.request("/api/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateProjectRequest(
  app: ReturnType<typeof createApp>["app"],
  id: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/project/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteWorkspaceRequest(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
) {
  return app.request(`/api/workspace/${workspaceId}`, { method: "DELETE" });
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Mirrors `work-item-create-read-list.test.ts`'s own local fixture builders -- this
// codebase's established per-file convention (no shared helper exists yet).
async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate) {
    throw new Error("makeDefaultState: state_template insert returned no row");
  }

  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state insert returned no row");
  return state;
}

describe("API integration: project.slug claims are permanent (#23 D1)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("blocks reclaiming a slug freed by RENAMING the project that held it (409 at project creation)", async () => {
    // Attacker claims "ACME" and burns one work-item key under it. `admin`, not the
    // default `member` -- the legacy `project` statement set only grants `member`
    // `["create", "read"]`; renaming needs `admin` (or `owner`), same as
    // `project-slug-unique.test.ts`'s own update test.
    const attacker = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(attacker.user);
    const { app: attackerApp } = createApp();

    const attackerCreate = await createProjectRequest(attackerApp, {
      workspaceId: attacker.workspace.id,
      name: "Attacker's project",
      icon: "Folder",
      slug: "ACME",
    });
    expect(attackerCreate.status).toBe(200);
    const attackerProject = (await attackerCreate.json()) as { id: string };

    const type = await makeWorkItemType(attacker.workspace.id);
    await makeDefaultState(attacker.workspace.id, attackerProject.id);
    const attackerWorkItem = await createWorkItemRequest(
      attackerApp,
      attackerProject.id,
      { typeId: type.id, title: "Burn ACME-1" },
    );
    expect(attackerWorkItem.status).toBe(200);
    const burnedKey = ((await attackerWorkItem.json()) as { key: string }).key;
    expect(burnedKey).toBe("ACME-1");

    // Attacker renames their own project away -- the slug is now free among LIVE
    // projects (before D1's fix, this was enough to let a victim reclaim it).
    const rename = await updateProjectRequest(attackerApp, attackerProject.id, {
      name: "Attacker's project",
      icon: "Folder",
      slug: "ACME-RETIRED",
      description: "",
    });
    expect(rename.status).toBe(200);

    // Victim, an entirely unrelated workspace, tries to claim the now-live-free slug.
    const victim = await createWorkspaceMember();
    mockAuthenticatedSession(victim.user);
    const { app: victimApp } = createApp();

    const victimCreate = await createProjectRequest(victimApp, {
      workspaceId: victim.workspace.id,
      name: "Victim's project",
      icon: "Folder",
      slug: "ACME",
    });

    // Blocked at PROJECT CREATION -- the victim never gets a project to create a work
    // item under in the first place, so the original F1 collision path never opens.
    expect(victimCreate.status).toBe(409);
    const body = await victimCreate.text();
    expect(body).not.toMatch(/constraint|violat|internal server error/i);

    const victimProjects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, victim.workspace.id));
    expect(victimProjects).toHaveLength(0);

    // The permanent registry still names the ORIGINAL claimant -- the rename did not
    // transfer or release the old slug's claim.
    const claim = await db.query.projectSlugClaimTable.findFirst({
      where: eq(schema.projectSlugClaimTable.slug, "ACME"),
    });
    expect(claim?.projectId).toBe(attackerProject.id);
  });

  it("blocks reclaiming a slug freed by hard-deleting the workspace that held it (409 at project creation), even though every trace of the attacker's own rows is gone", async () => {
    // Attacker is the OWNER of their own workspace (workspace delete requires
    // `organization:delete`, which -- by design -- resolves only from the compiled
    // `owner` role, never a seeded `workspace_role` row: see
    // `require-workspace-role-authority.ts`).
    const attacker = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(attacker.user);
    const { app: attackerApp } = createApp();

    const attackerCreate = await createProjectRequest(attackerApp, {
      workspaceId: attacker.workspace.id,
      name: "Attacker's project",
      icon: "Folder",
      slug: "ENG",
    });
    expect(attackerCreate.status).toBe(200);
    const attackerProject = (await attackerCreate.json()) as { id: string };

    const type = await makeWorkItemType(attacker.workspace.id);
    await makeDefaultState(attacker.workspace.id, attackerProject.id);
    for (let i = 0; i < 3; i++) {
      const created = await createWorkItemRequest(
        attackerApp,
        attackerProject.id,
        { typeId: type.id, title: `Burn ENG-${i + 1}` },
      );
      expect(created.status).toBe(200);
    }

    // Attacker hard-deletes their own workspace. This cascades away the workspace,
    // its project and every work item -- but `work_item_key_claim` has no FK to any of
    // it (deliberately), so the claims survive.
    const deletion = await deleteWorkspaceRequest(
      attackerApp,
      attacker.workspace.id,
    );
    expect(deletion.status).toBe(200);

    // Confirm the cascade really did remove everything an operator would think to look
    // at -- this is D1's "no trace left" property.
    expect(
      await db.query.workspaceTable.findFirst({
        where: eq(schema.workspaceTable.id, attacker.workspace.id),
      }),
    ).toBeUndefined();
    expect(
      await db.query.projectTable.findFirst({
        where: eq(schema.projectTable.id, attackerProject.id),
      }),
    ).toBeUndefined();
    const orphanedWorkItems = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, attackerProject.id));
    expect(orphanedWorkItems).toHaveLength(0);

    // The claim registry -- the ONLY surviving evidence -- still names the deleted
    // project's id.
    const claim = await db.query.projectSlugClaimTable.findFirst({
      where: eq(schema.projectSlugClaimTable.slug, "ENG"),
    });
    expect(claim?.projectId).toBe(attackerProject.id);

    // Victim, unrelated workspace, later tries to take the now-orphan-free slug.
    const victim = await createWorkspaceMember();
    mockAuthenticatedSession(victim.user);
    const { app: victimApp } = createApp();

    const victimCreate = await createProjectRequest(victimApp, {
      workspaceId: victim.workspace.id,
      name: "Victim's project",
      icon: "Folder",
      slug: "ENG",
    });

    expect(victimCreate.status).toBe(409);
    const victimProjects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, victim.workspace.id));
    expect(victimProjects).toHaveLength(0);
  });

  it("blocks the freed slug at project creation regardless of WHICH work-item number the attacker burned -- 'delayed detonation' never gets the chance to detonate", async () => {
    // The reviewer's own reproduction advanced `project.last_task_number` to a chosen
    // value via ordinary task creates, then spent exactly one work-item create to burn
    // a specific, non-1 key (`OPS-5`), so the victim's project looked healthy through
    // several creates and only failed at the attacker-chosen number. That "advance the
    // shared counter" step is orthogonal to what THIS fix changes (it is the identical
    // `claimWorkItemNumber` mechanism `work-item-create-read-list.test.ts`'s own
    // concurrency test already exercises) -- the counter is bumped directly here to
    // isolate what D1's fix actually changes: whether the victim's project can be
    // created AT ALL once the slug is freed, independent of which key was burned.
    // `admin`, not the default `member` -- renaming needs it (see the rename test above).
    const attacker = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(attacker.user);
    const { app: attackerApp } = createApp();

    const attackerCreate = await createProjectRequest(attackerApp, {
      workspaceId: attacker.workspace.id,
      name: "Attacker's project",
      icon: "Folder",
      slug: "OPS",
    });
    expect(attackerCreate.status).toBe(200);
    const attackerProject = (await attackerCreate.json()) as { id: string };

    // Simulate four prior ordinary creates (tasks or work items) having already
    // advanced the shared counter.
    await db
      .update(schema.projectTable)
      .set({ lastTaskNumber: 4 })
      .where(eq(schema.projectTable.id, attackerProject.id));

    const type = await makeWorkItemType(attacker.workspace.id);
    await makeDefaultState(attacker.workspace.id, attackerProject.id);
    const burn = await createWorkItemRequest(attackerApp, attackerProject.id, {
      typeId: type.id,
      title: "Burn OPS-5 specifically",
    });
    expect(burn.status).toBe(200);
    expect(((await burn.json()) as { key: string }).key).toBe("OPS-5");

    const rename = await updateProjectRequest(attackerApp, attackerProject.id, {
      name: "Attacker's project",
      icon: "Folder",
      slug: "OPS-OLD",
      description: "",
    });
    expect(rename.status).toBe(200);

    // Victim takes the freed slug. Before D1's fix, this would 200 -- the victim's
    // project would then work fine for items 1-4 and die permanently, forever, on its
    // 5th create (the exact number the attacker chose). With the fix, the victim never
    // gets a project at all: the detonation is defused at the front door, not survived
    // items 1-4 and hit at item 5.
    const victim = await createWorkspaceMember();
    mockAuthenticatedSession(victim.user);
    const { app: victimApp } = createApp();

    const victimCreate = await createProjectRequest(victimApp, {
      workspaceId: victim.workspace.id,
      name: "Victim's project",
      icon: "Folder",
      slug: "OPS",
    });
    expect(victimCreate.status).toBe(409);

    const victimProjects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, victim.workspace.id));
    expect(victimProjects).toHaveLength(0);
  });

  it("defence in depth: a pre-existing poisoned work_item_key_claim range (predating this fix) fails cleanly with 409, not a raw 500", async () => {
    // `project_slug_claim` stops a NEW poisoned range from ever becoming reachable, but
    // migration 0065's own backfill cannot see a slug that was already freed before it
    // ran (its own comment states this limitation explicitly). This reproduces that
    // residual case directly: a `work_item_key_claim` row for a key this project is
    // about to generate already exists, claimed by some OTHER (unrelated) work item.
    const holder = await createWorkspaceMember();
    mockAuthenticatedSession(holder.user);
    const { app } = createApp();

    const created = await createProjectRequest(app, {
      workspaceId: holder.workspace.id,
      name: "Pre-poisoned project",
      icon: "Folder",
      slug: "POISON",
    });
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };

    // Manufacture the pre-existing poisoned claim `POISON-1` would collide with --
    // exactly what an already-freed-and-reclaimed slug from before this fix existed
    // would have left behind. No FK on `work_item_key_claim.work_item_id`
    // (deliberately, per that table's own schema.ts comment), so a fabricated id is a
    // faithful stand-in for "some other, unrelated, already-deleted work item".
    await db.insert(schema.workItemKeyClaimTable).values({
      key: "POISON-1",
      workItemId: "work-item-from-a-different-tenant",
    });

    const type = await makeWorkItemType(holder.workspace.id);
    await makeDefaultState(holder.workspace.id, project.id);

    const attempt = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Should collide with the pre-poisoned claim",
    });

    expect(attempt.status).toBe(409);
    const body = await attempt.text();
    expect(body).not.toMatch(/internal server error/i);

    // No half-created work item leaked from the rejected attempt, and the counter was
    // rolled back with the failed transaction (same rollback behaviour F1's original
    // review relied on to prove the DoS was PERMANENT, not merely a one-time failure).
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows).toHaveLength(0);
    const row = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });
    expect(row?.lastTaskNumber).toBe(0);
  });

  it("lets a project rename BACK to a slug it once claimed itself, without error", async () => {
    // Not an exploit case -- a sanity check that the "claimed forever" rule is scoped to
    // OTHER projects, not to the claiming project reusing its own history. `admin`, not
    // the default `member` -- renaming needs it (see the rename test above).
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const created = await createProjectRequest(app, {
      workspaceId: owner.workspace.id,
      name: "Round trip",
      icon: "Folder",
      slug: "ROUNDTRIP",
    });
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };

    const renamedAway = await updateProjectRequest(app, project.id, {
      name: "Round trip",
      icon: "Folder",
      slug: "ROUNDTRIP-2",
      description: "",
    });
    expect(renamedAway.status).toBe(200);

    const renamedBack = await updateProjectRequest(app, project.id, {
      name: "Round trip",
      icon: "Folder",
      slug: "ROUNDTRIP",
      description: "",
    });
    expect(renamedBack.status).toBe(200);

    const row = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, project.id),
    });
    expect(row?.slug).toBe("ROUNDTRIP");

    // Both slugs this project has ever held remain claimed by it, and only it.
    const claims = await db
      .select()
      .from(schema.projectSlugClaimTable)
      .where(eq(schema.projectSlugClaimTable.projectId, project.id));
    expect(claims.map((c) => c.slug).sort()).toEqual([
      "ROUNDTRIP",
      "ROUNDTRIP-2",
    ]);
  });
});
