/**
 * S4 — the native update and delete routes. Issue #6, retrofit plan §3 (S4
 * row) and risks R8 (columns only the plugin wrote) and R10 (reachability).
 *
 * Soft delete is NOT in this batch: `workspace` has no `deleted_at` /
 * `purge_after` columns and adding them is a migration the retrofit plan
 * defers out of P0 (§3.2). Delete here is the existing hard delete over the
 * `ON DELETE CASCADE` chains, which is what the inherited route does today.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import {
  createWorkspaceNative,
  deleteWorkspaceNative,
  updateWorkspaceNative,
} from "./helpers/workspace-write-http";

beforeEach(async () => {
  await resetTestDatabase();
});

describe("S4 native update (A2-P16..A2-P19)", () => {
  it("A2-P16 updates name, slug, logo and description", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Original",
    });
    const { id } = (await created.json()) as { id: string };

    const slug = `renamed-${randomUUID().slice(0, 8)}`;
    const updated = await updateWorkspaceNative(app, owner.cookie, id, {
      name: "Renamed",
      slug,
      logo: "https://cdn.example.com/new.png",
      description: "Now described",
    });
    expect(updated.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id));
    expect(row?.name).toBe("Renamed");
    expect(row?.slug).toBe(slug);
    expect(row?.logo).toBe("https://cdn.example.com/new.png");
    expect(row?.description).toBe("Now described");
  });

  it("A2-P17 leaves unmentioned fields alone, and does not silently regenerate the slug on rename", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Keep My Slug",
      description: "Keep me",
    });
    const { id } = (await created.json()) as { id: string };
    const [before] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id));

    const updated = await updateWorkspaceNative(app, owner.cookie, id, {
      name: "New Name Only",
    });
    expect(updated.status).toBe(200);

    const [after] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id));
    expect(after?.name).toBe("New Name Only");
    expect(after?.slug).toBe(before?.slug);
    expect(after?.description).toBe("Keep me");
  });

  it("A2-P18 applies checkWorkspaceName to the new name and writes nothing when it fails", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Legit",
    });
    const { id } = (await created.json()) as { id: string };

    const updated = await updateWorkspaceNative(app, owner.cookie, id, {
      name: "Claim your prize at http://evil.example.com",
    });
    expect(updated.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id));
    expect(row?.name).toBe("Legit");
  });

  it("A2-P19b rejects an empty patch rather than silently succeeding", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Untouched",
    });
    const { id } = (await created.json()) as { id: string };

    const updated = await updateWorkspaceNative(app, owner.cookie, id, {});
    expect(updated.status).toBe(400);

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id));
    expect(row?.name).toBe("Untouched");
  });

  it("A2-P19 returns 409 — not 500 — when the new slug is taken by another workspace", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const takenSlug = `taken-${randomUUID().slice(0, 8)}`;
    await createWorkspaceNative(app, owner.cookie, {
      name: "Holder",
      slug: takenSlug,
    });
    const second = await createWorkspaceNative(app, owner.cookie, {
      name: "Mover",
    });
    const { id } = (await second.json()) as { id: string };

    const updated = await updateWorkspaceNative(app, owner.cookie, id, {
      slug: takenSlug,
    });
    expect(updated.status).toBe(409);

    // Re-applying its OWN slug is not a conflict.
    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, id));
    const same = await updateWorkspaceNative(app, owner.cookie, id, {
      slug: row?.slug,
    });
    expect(same.status).toBe(200);
  });
});

describe("S4 native delete (A2-P20..A2-P21)", () => {
  it("A2-P20 removes the workspace and everything cascading off it", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Doomed",
    });
    const { id } = (await created.json()) as { id: string };

    const removed = await deleteWorkspaceNative(app, owner.cookie, id);
    expect(removed.status).toBe(200);

    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.workspaceUserTable)
        .where(eq(schema.workspaceUserTable.workspaceId, id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(eq(schema.workspaceRoleTable.workspaceId, id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.teamTable)
        .where(eq(schema.teamTable.workspaceId, id)),
    ).toHaveLength(0);
    expect(await db.select().from(schema.teamMemberTable)).toHaveLength(0);
  });

  it("A2-P21 clears the caller's active workspace and team when the deleted workspace was the active one", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Active Then Gone",
    });
    const { id } = (await created.json()) as { id: string };

    const [sessionBefore] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, owner.user.id));
    expect(sessionBefore?.activeOrganizationId).toBe(id);
    expect(sessionBefore?.activeTeamId).not.toBeNull();

    expect((await deleteWorkspaceNative(app, owner.cookie, id)).status).toBe(
      200,
    );

    const [sessionAfter] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, sessionBefore?.id ?? ""));
    expect(sessionAfter?.activeOrganizationId).toBeNull();
    // The team row is cascade-deleted with the workspace, so leaving the
    // pointer behind would dangle. The inherited plugin clears only
    // active_organization_id; clearing both is a deliberate, narrower
    // divergence recorded in the pull request.
    expect(sessionAfter?.activeTeamId).toBeNull();
  });
});
