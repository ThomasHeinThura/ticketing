import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { createApp } from "../../apps/api/src/index";
import { scanWorkItemSla } from "../../apps/api/src/scheduler/sla-scan";
import { loadWorkItemRowSla } from "../../apps/api/src/work-item/row-sla";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { ensureCreationWorkflow } from "./helpers/workflow";

/**
 * P4R1-M2: feature flags that God Mode can switch are enforced at runtime (features.md, ST-11).
 * The fixture database starts with the runtime-gated flags on; each test switches one off at
 * the instance and checks the surface disappears, then switches it on and checks it returns.
 */

const PORTAL_HOST = "portal.localhost:5174";

async function setInstanceFlag(featureKey: string, enabled: boolean) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey, enabled })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled },
    });
  invalidateFeatureFlagCache();
}

async function cookieSession(userId: string) {
  const now = new Date();
  const token = `p4r1-m2-${randomUUID()}`;
  await db.insert(schema.sessionTable).values({
    id: `session-${userId}`,
    token,
    userId,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  return `__Host-tdk_agent_session=${token}`;
}

/** A workspace whose default SLA policy has a published version, and a project to create in. */
async function slaWorld() {
  const owner = await createWorkspaceMember({ role: "admin" });
  mockAuthenticatedSession(owner.user);
  const cookie = await cookieSession(owner.user.id);
  const { app } = createApp();
  const workspaceId = owner.workspace.id;
  const [calendar] = await db
    .insert(schema.serviceCalendarTable)
    .values({
      workspaceId,
      name: "Weekday support",
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 1020 }] },
      holidays: [],
    })
    .returning();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Incident",
      category: "service",
    })
    .returning();
  const [policy] = await db
    .insert(schema.slaPolicyTable)
    .values({ workspaceId, name: "Default policy" })
    .returning();
  if (!calendar || !type || !policy) throw new Error("SLA fixture missing");
  const [version] = await db
    .insert(schema.slaPolicyVersionTable)
    .values({
      workspaceId,
      policyId: policy.id,
      number: 1,
      calendarId: calendar.id,
      atRiskThresholdPct: 75,
    })
    .returning();
  if (!version) throw new Error("SLA version fixture missing");
  // One goal, so an item created under this policy has a badge to show (or hide).
  await db.insert(schema.slaGoalTable).values({
    workspaceId,
    versionId: version.id,
    metric: "resolution",
    workItemTypeId: type.id,
    priority: "high",
    targetMinutes: 600,
  });
  // Published: versions are created as drafts and become effective on publish.
  await db
    .update(schema.slaPolicyVersionTable)
    .set({ effectiveFrom: new Date(Date.now() - 60_000) })
    .where(eq(schema.slaPolicyVersionTable.id, version.id));
  await db
    .update(schema.workspaceTable)
    .set({ defaultSlaPolicyId: policy.id })
    .where(eq(schema.workspaceTable.id, workspaceId));
  const { project } = await createProjectFixture({ workspaceId });
  await grantProjectRole(owner.user.id, project.id, [
    "project:read",
    "work_item:read",
    "work_item:create",
  ]);
  const now = new Date();
  const [template] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `backlog-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!template) throw new Error("state template fixture missing");
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  await ensureCreationWorkflow({
    workspaceId,
    projectId: project.id,
    typeId: type.id,
  });
  const createItem = async (title: string) => {
    const response = await csrfRequest(
      app,
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ typeId: type.id, title, priority: "high" }),
      },
      cookie,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { id: string; key: string };
    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, body.id));
    if (!row) throw new Error("created work item missing");
    return { ...row, key: body.key };
  };
  return { app, cookie, workspaceId, version, createItem };
}

describe("feature flag enforcement (P4R1-M2)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("feature.scim off: every SCIM call answers 404 before the bearer is read; on: the bearer is checked", async () => {
    const { app } = createApp();
    const call = () =>
      app.request("/scim/v2/Users", {
        headers: { authorization: `Bearer ${"x".repeat(43)}` },
      });
    await setInstanceFlag("feature.scim", false);
    const off = await call();
    expect(off.status).toBe(404);
    expect(off.headers.get("content-type")).toContain("application/scim+json");
    await setInstanceFlag("feature.scim", true);
    expect((await call()).status).toBe(401);
  });

  it("feature.customer_portal off: the portal API answers 404 and the portal host serves the disabled notice", async () => {
    await db
      .insert(schema.instanceSettingTable)
      .values({ id: "singleton", setupCompletedAt: new Date() })
      .onConflictDoNothing();
    // P3-R2-03: the switched-off host serves the portal app itself (with the disabled marker)
    // so the page is the library-built feature-off state, not a hand-written notice.
    const portalRoot = mkdtempSync(join(tmpdir(), "taskdesk-p4r1-portal-"));
    writeFileSync(
      join(portalRoot, "index.html"),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>',
    );
    const { app } = createApp({ portalStaticRoot: portalRoot });
    const api = () =>
      app.request("/api/public/terminology", {
        headers: { host: PORTAL_HOST },
      });
    await setInstanceFlag("feature.customer_portal", false);
    const offApi = await api();
    expect(offApi.status).toBe(404);
    const offPage = await app.request("/", { headers: { host: PORTAL_HOST } });
    expect(offPage.status).toBe(404);
    expect(await offPage.text()).toContain(
      '<meta name="taskdesk-portal-state" content="disabled">',
    );
    rmSync(portalRoot, { recursive: true, force: true });

    // A workspace that offers the portal brings the host back.
    const owner = await createWorkspaceMember({ role: "admin" });
    await db.insert(schema.workspaceFeatureFlagTable).values({
      workspaceId: owner.workspace.id,
      featureKey: "feature.customer_portal",
      enabled: true,
    });
    invalidateFeatureFlagCache();
    expect((await api()).status).not.toBe(404);
  });

  it("feature.sla off: policy and calendar routes, the SLA panel and badges are gone and no clock starts; on: they return", async () => {
    const w = await slaWorld();
    await setInstanceFlag("feature.sla", false);

    const offItem = await w.createItem("Created while SLA is off");
    expect(offItem.slaPolicyVersionId).toBeNull();
    const policies = await w.app.request(
      `/api/sla-policies?workspaceId=${w.workspaceId}`,
      { headers: { cookie: w.cookie } },
    );
    expect(policies.status).toBe(404);
    const calendars = await w.app.request(
      `/api/service-calendars?workspaceId=${w.workspaceId}`,
      { headers: { cookie: w.cookie } },
    );
    expect(calendars.status).toBe(404);

    await setInstanceFlag("feature.sla", true);
    const onItem = await w.createItem("Created while SLA is on");
    expect(onItem.slaPolicyVersionId).toBe(w.version.id);
    expect(
      (
        await w.app.request(`/api/work-items/${onItem.key}/sla`, {
          headers: { cookie: w.cookie },
        })
      ).status,
    ).not.toBe(404);
    expect(
      (
        await w.app.request(`/api/sla-policies?workspaceId=${w.workspaceId}`, {
          headers: { cookie: w.cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await w.app.request(
          `/api/service-calendars?workspaceId=${w.workspaceId}`,
          { headers: { cookie: w.cookie } },
        )
      ).status,
    ).toBe(200);

    // Switched off again: the pinned item keeps its record (ST-11) but shows nothing.
    await setInstanceFlag("feature.sla", false);
    const [pinned] = await db
      .select({ slaPolicyVersionId: schema.workItemTable.slaPolicyVersionId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, onItem.id));
    expect(pinned?.slaPolicyVersionId).toBe(w.version.id);
    const panel = await w.app.request(`/api/work-items/${onItem.key}/sla`, {
      headers: { cookie: w.cookie },
    });
    expect(panel.status).toBe(404);
    const badges = await loadWorkItemRowSla(db, [onItem]);
    expect(badges.size).toBe(0);
    expect(await scanWorkItemSla(onItem.id)).toBe(0);
    await setInstanceFlag("feature.reports", true);
    const reports = await w.app.request(
      `/api/reports?workspaceId=${w.workspaceId}`,
      { headers: { cookie: w.cookie } },
    );
    expect(reports.status, await reports.clone().text()).toBe(200);
    const listed = (await reports.json()) as {
      data: { key: string; available: boolean }[];
    };
    for (const key of [
      "sla_attainment",
      "sla_trend",
      "breach_analysis",
      "at_risk_now",
    ])
      expect(
        listed.data.find((report) => report.key === key)?.available,
        key,
      ).toBe(false);
  });

  it("feature.sla resolves per project (P4R2-M2): a project override decides clock start, badges and the scanner", async () => {
    const w = await slaWorld();
    const [project] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, w.workspaceId));
    if (!project) throw new Error("project fixture missing");
    const setProject = async (enabled: boolean | null) => {
      await db
        .delete(schema.projectFeatureFlagTable)
        .where(eq(schema.projectFeatureFlagTable.projectId, project.id));
      if (enabled !== null)
        await db.insert(schema.projectFeatureFlagTable).values({
          projectId: project.id,
          featureKey: "feature.sla",
          enabled,
        });
    };

    // Workspace (instance) on, project off: no clock, no badge, no scan.
    await setInstanceFlag("feature.sla", true);
    const pinned = await w.createItem("Pinned before the project switched off");
    expect(pinned.slaPolicyVersionId).toBe(w.version.id);
    expect((await loadWorkItemRowSla(db, [pinned])).size).toBe(1);
    await setProject(false);
    const offItem = await w.createItem("Created in a project with SLA off");
    expect(offItem.slaPolicyVersionId).toBeNull();
    expect((await loadWorkItemRowSla(db, [pinned])).size).toBe(0);
    expect(await scanWorkItemSla(pinned.id)).toBe(0);
    const panel = (key: string) =>
      w.app.request(`/api/work-items/${key}/sla`, {
        headers: { cookie: w.cookie },
      });
    expect((await panel(pinned.key)).status).toBe(404);

    // Workspace off, project on: the project keeps its SLA.
    await setInstanceFlag("feature.sla", false);
    await setProject(true);
    const onItem = await w.createItem("Created in a project with SLA on");
    expect(onItem.slaPolicyVersionId).toBe(w.version.id);
    expect((await loadWorkItemRowSla(db, [onItem])).size).toBe(1);
    expect((await panel(onItem.key)).status).toBe(200);
  });
});
