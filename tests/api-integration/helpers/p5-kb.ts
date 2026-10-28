import { and, eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import {
  kbArticleTable,
  kbArticleVersionTable,
} from "../../../apps/api/src/database/schema-p5-kb";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import { createCustomerPrincipal } from "./customer-principal";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./fixtures";
import { addMember } from "./reach-world";

export const PORTAL_HOST = "portal.localhost:5174";
export const JSON_HEADERS = { "content-type": "application/json" };

type User = Parameters<typeof mockAuthenticatedSession>[0];

export async function setKbFlag(workspaceId: string, enabled: boolean) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({
      featureKey: "feature.knowledge_base",
      enabled: true,
      locked: false,
    })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId, featureKey: "feature.knowledge_base", enabled })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled },
    });
}

/**
 * One workspace with: an owner (publisher), a member (writer), a viewer, a member who reaches
 * project A, customer A (organisation bound to project A), customer B (another organisation
 * bound to nothing) and an unbound project B.
 */
export async function kbWorld() {
  const owner = await createWorkspaceMember({ role: "owner" });
  const workspaceId = owner.workspace.id;
  await setKbFlag(workspaceId, true);
  const { project: projectA } = await createProjectFixture({ workspaceId });
  const { project: projectB } = await createProjectFixture({ workspaceId });
  const customerA = await createCustomerPrincipal();
  const customerB = await createCustomerPrincipal();
  await db
    .update(schema.projectTable)
    .set({ organisationId: customerA.orgId })
    .where(eq(schema.projectTable.id, projectA.id));
  const member = await addMember(workspaceId, "member");
  const viewer = await addMember(workspaceId, "viewer");
  const reacher = await addMember(workspaceId, "member");
  await grantProjectRole(reacher.user.id, projectA.id, [
    "project:read",
    "work_item:read",
  ]);
  const { app } = createApp();

  function agent(
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
  return {
    owner,
    member,
    viewer,
    reacher,
    customerA,
    customerB,
    projectA,
    projectB,
    workspaceId,
    app,
    agent,
    portal,
  };
}

export type KbWorld = Awaited<ReturnType<typeof kbWorld>>;

export function doc(...paragraphs: string[]) {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

/** A row written straight to the database (any state combination, with a version when published). */
export async function insertArticle(
  workspaceId: string,
  values: Partial<typeof kbArticleTable.$inferInsert> & { title: string },
) {
  const published = values.state === "published";
  const body = values.body ?? doc(`${values.title} body`);
  const [row] = await db
    .insert(kbArticleTable)
    .values({
      workspaceId,
      body,
      bodyText: `${values.title} body`,
      state: "draft",
      customerVisible: false,
      publishedVersion: published ? 1 : null,
      publishedAt: published ? new Date() : null,
      ...values,
    })
    .returning();
  if (!row) throw new Error("article fixture missing");
  if (published)
    await db.insert(kbArticleVersionTable).values({
      articleId: row.id,
      number: 1,
      title: row.title,
      body: row.body,
      bodyText: row.bodyText,
    });
  return row;
}

export async function articleRow(id: string) {
  const [row] = await db
    .select()
    .from(kbArticleTable)
    .where(eq(kbArticleTable.id, id));
  return row;
}

export async function versionRows(articleId: string) {
  return db
    .select()
    .from(kbArticleVersionTable)
    .where(and(eq(kbArticleVersionTable.articleId, articleId)));
}

export async function auditActions(workspaceId: string) {
  const rows = await db
    .select({ action: schema.auditLogTable.action })
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.workspaceId, workspaceId));
  return rows.map((row) => row.action);
}
