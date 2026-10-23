/**
 * P1 PR-2..PR-4 inherited project membership (WRITTEN, NOT RUN by its author -- the
 * coordinator runs DB integration tests).
 *
 * Inherited membership is evaluated AT READ TIME: no inherited rows are written. A member of a
 * parent project reaches its children through `ProjectReachFacts.ancestorProjectIds`
 * (`loadProjectAncestorIds`, `reaches()`) and through the SQL `currentProjectReachPredicate`
 * (the project list, search, saved views, preferences ...). Both must agree.
 */

import { reaches } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { currentProjectReachPredicate } from "../../apps/api/src/database/repositories/identity-scope.repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import {
  loadAncestorIdsByProject,
  loadProjectAncestorIds,
  setProjectParent,
} from "../../apps/api/src/project/hierarchy.repository";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { projectKey } from "./helpers/project-key";
import { addMember } from "./helpers/reach-world";

async function world() {
  const owner = await createWorkspaceMember({ role: "admin" });
  const workspaceId = owner.workspace.id;
  const parent = (
    await createProjectFixture({ workspaceId, slug: projectKey() })
  ).project;
  const child = (
    await createProjectFixture({ workspaceId, slug: projectKey() })
  ).project;
  const sibling = (
    await createProjectFixture({ workspaceId, slug: projectKey() })
  ).project;
  await setProjectParent(db, child.id, parent.id);
  return { workspaceId, parent, child, sibling };
}

async function staffIdentity(userId: string) {
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) throw new Error("identity missing");
  return identity;
}

async function sqlReaches(
  identity: Awaited<ReturnType<typeof staffIdentity>>,
  projectId: string,
) {
  const rows = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(
      currentProjectReachPredicate(
        identity,
        schema.projectTable.id,
        schema.projectTable.workspaceId,
        schema.projectTable.organisationId,
      ),
    );
  return rows.some((row) => row.id === projectId);
}

async function evaluatorReaches(
  identity: Awaited<ReturnType<typeof staffIdentity>>,
  w: Awaited<ReturnType<typeof world>>,
  projectId: string,
) {
  return reaches(identity, {
    projectId,
    workspaceId: w.workspaceId,
    organisationId: null,
    ancestorProjectIds: await loadProjectAncestorIds(
      db,
      w.workspaceId,
      projectId,
    ),
  });
}

describe("API integration: inherited project membership (PR-2..PR-4)", () => {
  beforeEach(async () => resetTestDatabase());

  it("a parent member reaches the child (evaluator and SQL predicate agree), and not the sibling", async () => {
    const w = await world();
    const member = await addMember(w.workspaceId, "member");
    await grantProjectRole(member.user.id, w.parent.id, ["project:read"]);
    const identity = await staffIdentity(member.user.id);

    expect(await evaluatorReaches(identity, w, w.child.id)).toBe(true);
    expect(await sqlReaches(identity, w.child.id)).toBe(true);
    expect(await evaluatorReaches(identity, w, w.sibling.id)).toBe(false);
    expect(await sqlReaches(identity, w.sibling.id)).toBe(false);
    // Inheritance flows down only.
    const childOnly = await addMember(w.workspaceId, "member");
    await grantProjectRole(childOnly.user.id, w.child.id, ["project:read"]);
    const childIdentity = await staffIdentity(childOnly.user.id);
    expect(await evaluatorReaches(childIdentity, w, w.parent.id)).toBe(false);
    expect(await sqlReaches(childIdentity, w.parent.id)).toBe(false);
  });

  it("writes no inherited rows: the child roster is unchanged", async () => {
    const w = await world();
    const member = await addMember(w.workspaceId, "member");
    await grantProjectRole(member.user.id, w.parent.id, ["project:read"]);
    const rows = await db
      .select()
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.scopeId, w.child.id));
    expect(rows).toHaveLength(0);
  });

  it("an explicit child membership overrides the inherited role (PR-3) and keeps reach", async () => {
    const w = await world();
    const member = await addMember(w.workspaceId, "member");
    await grantProjectRole(member.user.id, w.parent.id, [
      "project:read",
      "work_item:update",
    ]);
    await grantProjectRole(member.user.id, w.child.id, ["project:read"]);
    const identity = await staffIdentity(member.user.id);
    expect(await evaluatorReaches(identity, w, w.child.id)).toBe(true);
    // The child-scope grant is the one authority applies on the child.
    const { can } = await import("@taskdesk/permissions");
    expect(
      can(identity, "work_item:update", "project", {
        projectId: w.child.id,
        workspaceId: w.workspaceId,
      }),
    ).toBe(false);
    expect(
      can(identity, "work_item:update", "project", {
        projectId: w.parent.id,
        workspaceId: w.workspaceId,
      }),
    ).toBe(true);
  });

  it("an outsider is still denied", async () => {
    const w = await world();
    const outsider = await addMember(w.workspaceId, "member");
    const identity = await staffIdentity(outsider.user.id);
    expect(await evaluatorReaches(identity, w, w.child.id)).toBe(false);
    expect(await sqlReaches(identity, w.child.id)).toBe(false);
  });

  it("inheritance never crosses workspaces and stops at a soft-deleted ancestor", async () => {
    const w = await world();
    const other = await createWorkspaceMember({ role: "admin" });
    const foreign = (
      await createProjectFixture({
        workspaceId: other.workspace.id,
        slug: projectKey(),
      })
    ).project;
    const grandchild = (
      await createProjectFixture({
        workspaceId: w.workspaceId,
        slug: projectKey(),
      })
    ).project;
    await setProjectParent(db, grandchild.id, w.child.id);
    const member = await addMember(w.workspaceId, "member");
    await grantProjectRole(member.user.id, w.parent.id, ["project:read"]);
    const identity = await staffIdentity(member.user.id);

    expect(await sqlReaches(identity, grandchild.id)).toBe(true);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.child.id));
    expect(await evaluatorReaches(identity, w, grandchild.id)).toBe(false);
    expect(await sqlReaches(identity, grandchild.id)).toBe(false);

    // A parent id outside the workspace cannot even be stored: the composite FK
    // `project_workspace_parent_fk` (workspace_id, parent_id) refuses it (23503), so the
    // tenant boundary holds below the application. The ancestor loaders also filter by
    // workspace as defence in depth; with the FK that state is unreachable by SQL.
    await expect(
      setProjectParent(db, w.sibling.id, foreign.id),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(
      await loadProjectAncestorIds(db, w.workspaceId, w.sibling.id),
    ).toEqual([]);
    const batch = await loadAncestorIdsByProject(db, [w.workspaceId]);
    expect(batch.get(w.sibling.id)).toEqual([]);
  });

  it("customer-side callers never inherit", async () => {
    const w = await world();
    // A REAL customer principal (customer-side person + organisation membership) that also
    // holds a project-scope row on the parent. Neither reach nor authority may flow to the child.
    const customer = await createCustomerPrincipal();
    await grantProjectRole(customer.user.id, w.parent.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
    ]);
    const identity = await staffIdentity(customer.user.id);
    expect(identity.side).toBe("customer");
    expect(identity.reach.kind).toBe("organisation");
    expect(await sqlReaches(identity, w.child.id)).toBe(false);
    expect(await evaluatorReaches(identity, w, w.child.id)).toBe(false);
    const { authorityFor } = await import("@taskdesk/permissions");
    expect(
      authorityFor(identity, "work_item", {
        projectId: w.child.id,
        workItemProjectId: w.child.id,
        workspaceId: w.workspaceId,
        ancestorProjectIds: await loadProjectAncestorIds(
          db,
          w.workspaceId,
          w.child.id,
        ),
      }).has("work_item:update"),
    ).toBe(false);
  });

  it("inherited authority: a parent viewer is a viewer on the child, a child grant overrides (PR-3, P1-1)", async () => {
    const w = await world();
    const { can } = await import("@taskdesk/permissions");
    const member = await addMember(w.workspaceId, "admin");
    await grantProjectRole(member.user.id, w.parent.id, [
      "project:read",
      "work_item:read",
    ]);
    const identity = await staffIdentity(member.user.id);
    const ancestors = await loadProjectAncestorIds(
      db,
      w.workspaceId,
      w.child.id,
    );
    const childTarget = {
      projectId: w.child.id,
      workItemProjectId: w.child.id,
      workspaceId: w.workspaceId,
      ancestorProjectIds: ancestors,
    };
    expect(can(identity, "work_item:read", "work_item", childTarget)).toBe(
      true,
    );
    expect(can(identity, "work_item:update", "work_item", childTarget)).toBe(
      false,
    );
    // The same caller without the ancestor list would fall back to the (wider) workspace role:
    // the API therefore always supplies the chain wherever it evaluates project authority.
    await grantProjectRole(member.user.id, w.child.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
    ]);
    const widened = await staffIdentity(member.user.id);
    expect(can(widened, "work_item:update", "work_item", childTarget)).toBe(
      true,
    );
  });
  // PR-4 (409 inherited_membership on the child) is covered through the roster routes in
  // project-roster.test.ts; the decision rule DB-free in tests/api/project/project-roster.test.ts.
});
