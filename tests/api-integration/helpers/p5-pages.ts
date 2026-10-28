import { eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import { createCustomerPrincipal } from "./customer-principal";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./fixtures";
import { addMember } from "./reach-world";

export const JSON_HEADERS = { "content-type": "application/json" };
export const PORTAL_HOST = "portal.localhost:5174";
type User = Parameters<typeof mockAuthenticatedSession>[0];

export function doc(...paragraphs: string[]) {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

/**
 * One workspace: an editor (project:read + project:update on the project), a reader
 * (project:read only), an outsider (workspace member with no project role), a second project, a
 * foreign workspace with its own owner, and a customer principal whose organisation owns the
 * project.
 */
export async function setPagesFlag(projectIds: string[], enabled: boolean) {
  for (const projectId of projectIds)
    await db
      .insert(schema.projectFeatureFlagTable)
      .values({ projectId, featureKey: "feature.pages", enabled })
      .onConflictDoUpdate({
        target: [
          schema.projectFeatureFlagTable.projectId,
          schema.projectFeatureFlagTable.featureKey,
        ],
        set: { enabled },
      });
}

export async function pagesWorld(options: { pagesOn?: boolean } = {}) {
  const editor = await createWorkspaceMember({ role: "owner" });
  const workspaceId = editor.workspace.id;
  const { project } = await createProjectFixture({ workspaceId });
  const { project: otherProject } = await createProjectFixture({ workspaceId });
  for (const id of [project.id, otherProject.id])
    await grantProjectRole(editor.user.id, id, [
      "project:read",
      "project:update",
    ]);
  const reader = await addMember(workspaceId, "member");
  await grantProjectRole(reader.user.id, project.id, ["project:read"]);
  const outsider = await addMember(workspaceId, "member");
  const foreign = await createWorkspaceMember({ role: "owner" });
  const { project: foreignProject } = await createProjectFixture({
    workspaceId: foreign.workspace.id,
  });
  await grantProjectRole(foreign.user.id, foreignProject.id, [
    "project:read",
    "project:update",
  ]);
  await setPagesFlag(
    [project.id, otherProject.id, foreignProject.id],
    options.pagesOn ?? true,
  );
  const customer = await createCustomerPrincipal();
  await db
    .update(schema.projectTable)
    .set({ organisationId: customer.orgId })
    .where(eq(schema.projectTable.id, project.id));
  const { app } = createApp();

  function call(
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
  function portal(
    user: User,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    mockAuthenticatedSession(user, { portal: "customer" });
    return app.request(`http://${PORTAL_HOST}${path}`, {
      method: init.method ?? "GET",
      headers: { host: PORTAL_HOST, ...JSON_HEADERS },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
  async function json<T>(response: Response, status = 200): Promise<T> {
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  }
  const base = (projectId = project.id) => `/api/projects/${projectId}/pages`;
  return {
    editor,
    reader,
    outsider,
    foreign,
    customer,
    workspaceId,
    project,
    otherProject,
    foreignProject,
    app,
    call,
    portal,
    json,
    base,
  };
}
export type PagesWorld = Awaited<ReturnType<typeof pagesWorld>>;

export type PageBody = {
  id: string;
  title: string;
  version: number;
  parentId: string | null;
  body: unknown;
  canEdit: boolean;
};
