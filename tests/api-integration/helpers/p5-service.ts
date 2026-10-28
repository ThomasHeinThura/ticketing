import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import {
  changeDetailTable,
  changeFreezeTable,
  serviceTable,
} from "../../../apps/api/src/database/schema-p5-service";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
  grantWorkItemProjectAccess,
} from "./fixtures";
import { addMember } from "./reach-world";

export const JSON_HEADERS = { "content-type": "application/json" };

type User = Parameters<typeof mockAuthenticatedSession>[0];

export async function setServiceFlag(workspaceId: string, enabled: boolean) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({
      featureKey: "feature.service_catalogue",
      enabled: true,
      locked: false,
    })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId, featureKey: "feature.service_catalogue", enabled })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled },
    });
}

/**
 * A workspace with the service catalogue on: an owner, a plain member (no service, change or
 * release authority), a viewer, a project, and a second tenant (workspace) for isolation checks.
 */
export async function serviceWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  await setServiceFlag(workspaceId, true);
  const { project } = await createProjectFixture({ workspaceId });
  await grantProjectManageAccess(owner.user.id, project.id);
  await grantWorkItemProjectAccess(owner.user.id, project.id);
  // The project role overrides the workspace role on the project (see grantProjectManageAccess).
  await grantProjectRole(owner.user.id, project.id, [
    "change:manage",
    "approval:request",
    "approval:request_cab",
  ]);
  // The pending-action flow needs the requester's session row (credential id).
  await db.insert(schema.sessionTable).values({
    id: `session-${owner.user.id}`,
    token: randomUUID(),
    userId: owner.user.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const member = await addMember(workspaceId, "member");
  const viewer = await addMember(workspaceId, "viewer");
  const stranger = await createWorkspaceMember({ role: "owner" });
  await setServiceFlag(stranger.workspace.id, true);
  const { app } = createApp();

  function as(
    user: User,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    mockAuthenticatedSession(user);
    return app.request(path, {
      method: init.method ?? "GET",
      headers: JSON_HEADERS,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
  const ownerCall = (
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) => as(owner.user, path, init);

  async function makeService(name = `Service ${randomUUID().slice(0, 6)}`) {
    const response = await ownerCall("/api/services", {
      method: "POST",
      body: { workspaceId, name },
    });
    if (response.status !== 200)
      throw new Error(
        `makeService ${response.status} ${await response.text()}`,
      );
    return (await response.json()) as { id: string; name: string };
  }

  return {
    app,
    owner,
    member,
    viewer,
    stranger,
    workspaceId,
    project,
    as,
    ownerCall,
    makeService,
  };
}
export type ServiceWorld = Awaited<ReturnType<typeof serviceWorld>>;

/** Direct row writes for states the API cannot reach cheaply. */
export async function insertFreeze(
  workspaceId: string,
  startsAt: Date,
  endsAt: Date,
  name = "Year-end freeze",
) {
  const [row] = await db
    .insert(changeFreezeTable)
    .values({ workspaceId, name, startsAt, endsAt })
    .returning();
  if (!row) throw new Error("freeze");
  return row;
}

export async function changeDetailOf(workItemId: string) {
  const [row] = await db
    .select()
    .from(changeDetailTable)
    .where(eq(changeDetailTable.workItemId, workItemId));
  return row;
}

export async function serviceRow(id: string) {
  const [row] = await db
    .select()
    .from(serviceTable)
    .where(eq(serviceTable.id, id));
  return row;
}
