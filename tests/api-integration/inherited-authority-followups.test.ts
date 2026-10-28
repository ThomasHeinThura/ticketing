/**
 * P1-1 follow-up (WRITTEN, NOT RUN by its author -- the coordinator runs DB integration
 * tests): every authority path other than the main route chain must follow the ancestor
 * chain, so a person narrowed on a PARENT project is never widened on a child by a workspace
 * role. Covers the approved-deletion re-check, notification current-read eligibility and the
 * assignable picker (canAssign).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { canReadNativeInboxCandidate } from "../../apps/api/src/notification/native-inbox-reach";
import { findCurrentNotificationResource } from "../../apps/api/src/notification/repository";
import {
  loadWorkItemDeletionTarget,
  workItemDeletionAccess,
} from "../../apps/api/src/pending-action/work-item-deletion-target";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { setProjectParent } from "../../apps/api/src/project/hierarchy.repository";
import { projectAncestryFor } from "../../apps/api/src/utils/project-ancestry";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
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
  await setProjectParent(db, child.id, parent.id);
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "To Do",
        group: "unstarted",
      })
      .returning(),
    "template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: child.id,
        stateTemplateId: template.id,
        isDefault: true,
      })
      .returning(),
    "state",
  );
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        projectId: child.id,
        workspaceId,
        typeId: type.id,
        number: 1,
        key: `${child.slug}-1`,
        title: "Child item",
        stateId: state.id,
      })
      .returning(),
    "item",
  );
  return { workspaceId, parent, child, item };
}

/** A strong workspace role with only a parent-project grant carrying `capabilities`. */
async function parentOnly(
  w: Awaited<ReturnType<typeof world>>,
  capabilities: string[],
) {
  const member = await addMember(w.workspaceId, "admin");
  await grantProjectRole(member.user.id, w.parent.id, capabilities);
  const identity = await resolveIdentity({
    userId: member.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("identity missing");
  return { member, identity };
}

describe("API integration: inherited authority on non-route paths (P1-1 follow-up)", () => {
  beforeEach(async () => resetTestDatabase());

  it("an approved deletion cannot be executed on a child by a parent-only viewer", async () => {
    const w = await world();
    const viewer = await parentOnly(w, ["project:read", "work_item:read"]);
    const lead = await parentOnly(w, [
      "project:read",
      "work_item:read",
      "work_item:delete",
    ]);
    await db.transaction(async (tx) => {
      const target = await loadWorkItemDeletionTarget(tx, w.item.key);
      if (!target) throw new Error("target missing");
      expect(
        await workItemDeletionAccess(tx, viewer.identity, target),
      ).toMatchObject({ allowed: false, failure: "capability" });
      // Reach is inherited for both, so the viewer is refused on capability (403), not 404;
      // a parent lead holding work_item:delete is allowed through inheritance alone.
      expect(await workItemDeletionAccess(tx, lead.identity, target)).toEqual({
        allowed: true,
      });
    });
  });

  it("a parent-only member without work_item:read gets no child notification; with it they do", async () => {
    const w = await world();
    const blind = await parentOnly(w, ["project:read"]);
    const reader = await parentOnly(w, ["project:read", "work_item:read"]);
    const resource = await db.transaction((tx) =>
      findCurrentNotificationResource(tx, {
        resourceType: "work_item",
        resourceId: w.item.id,
        eventKind: "work_item.unblocked",
        canonicalWorkItem: { id: w.item.id, key: w.item.key },
      }),
    );
    if (!resource) throw new Error("resource missing");
    const canRead = async (who: typeof blind) =>
      canReadNativeInboxCandidate(
        who.identity,
        {
          userId: who.member.user.id,
          personId: who.identity.personId,
          resourceType: "work_item",
          resourceId: w.item.id,
          kind: "work_item.unblocked",
        },
        resource,
        await projectAncestryFor(db, who.identity, w.workspaceId, w.child.id),
      );
    expect(await canRead(blind)).toBe(false);
    expect(await canRead(reader)).toBe(true);
  });

  it("the assignable picker (canAssign) is empty for a parent-only viewer on the child", async () => {
    const w = await world();
    const viewer = await parentOnly(w, ["project:read", "work_item:read"]);
    mockAuthenticatedSession(viewer.member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/projects/${w.child.id}/assignable`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual([]);
    // Sanity: the child row exists and is the one addressed.
    const [row] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, w.child.id));
    expect(row?.id).toBe(w.child.id);
  });
});
