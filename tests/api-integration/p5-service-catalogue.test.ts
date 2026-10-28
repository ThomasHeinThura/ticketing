/**
 * P5 service catalogue (SVC-1..SVC-5): services, owners, links, dependencies, the impact list
 * with cycle handling, person-set status, the incident count per service, deletion through the
 * pending-action flow, the feature flag, capability denial and tenant isolation.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { makeTeam, workItemWorld } from "./helpers/p4-closeout";
import { serviceWorld, setServiceFlag } from "./helpers/p5-service";

type ServiceBody = {
  id: string;
  name: string;
  status: string;
  supportLevel: string;
  ownerTeamName: string | null;
  incidentCount: number;
  openChangeCount: number;
  dependsOn: { id: string; name: string }[];
  dependents: { id: string; name: string }[];
  links: { kind: string; projectId: string | null; url: string | null }[];
  releaseChecklist: { text: string }[];
  cycleDetected: boolean;
  deletionBlockers: string[];
};

beforeEach(async () => resetTestDatabase());

describe("service catalogue", () => {
  it("creates a service with owner team, support level, links, dependencies and a release checklist (SVC-1, SVC-2)", async () => {
    const w = await serviceWorld();
    const team = await makeTeam(w.workspaceId, []);
    const db1 = await w.makeService("Database");
    const created = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Checkout API",
        description: "Takes the money",
        category: "Platform",
        ownerTeamId: team.id,
        supportLevel: "L2",
        dependsOnServiceIds: [db1.id],
        links: [
          { kind: "documentation", url: "https://docs.example.com/checkout" },
          { kind: "project", projectId: w.project.id },
        ],
        releaseChecklist: ["Run smoke tests", "Notify support"],
      },
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const body = (await created.json()) as ServiceBody;
    expect(body.supportLevel).toBe("L2");
    expect(body.ownerTeamName).toBe(team.name);
    expect(body.status).toBe("operational");
    expect(body.dependsOn.map((s) => s.name)).toEqual(["Database"]);
    expect(body.links.map((l) => l.kind).sort()).toEqual([
      "documentation",
      "project",
    ]);
    expect(body.releaseChecklist.map((i) => i.text)).toEqual([
      "Run smoke tests",
      "Notify support",
    ]);

    const list = await w.ownerCall(
      `/api/services?workspaceId=${w.workspaceId}`,
    );
    expect(list.status).toBe(200);
    expect(
      ((await list.json()) as { data: ServiceBody[] }).data.map((s) => s.name),
    ).toEqual(["Checkout API", "Database"]);

    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "service.created"));
    expect(audit).toHaveLength(2);
  });

  it("refuses a duplicate name and a team from another workspace", async () => {
    const w = await serviceWorld();
    await w.makeService("Same");
    const dup = await w.ownerCall("/api/services", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "same" },
    });
    expect(dup.status).toBe(409);
    const foreignTeam = await makeTeam(w.stranger.workspace.id, []);
    const bad = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Other",
        ownerTeamId: foreignTeam.id,
      },
    });
    expect(bad.status).toBe(422);
  });

  it("status is set by a person and audited, never computed (SVC-4)", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService();
    const set = await w.ownerCall(`/api/services/${svc.id}/status`, {
      method: "POST",
      body: { status: "degraded", note: "Slow queries" },
    });
    expect(set.status, await set.clone().text()).toBe(200);
    expect(((await set.json()) as ServiceBody).status).toBe("degraded");
    const invalid = await w.ownerCall(`/api/services/${svc.id}/status`, {
      method: "POST",
      body: { status: "on-fire" },
    });
    expect(invalid.status).toBe(400);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "service.status_changed"));
    expect(audit).toHaveLength(1);
  });

  it("walks the impact list level by level with the customers served (SVC-5)", async () => {
    const w = await serviceWorld();
    const dbSvc = await w.makeService("DB");
    const api = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "API",
        dependsOnServiceIds: [dbSvc.id],
      },
    });
    const apiId = ((await api.json()) as ServiceBody).id;
    const web = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Web",
        dependsOnServiceIds: [apiId],
      },
    });
    const webId = ((await web.json()) as ServiceBody).id;
    // Web serves a customer through a linked project.
    const org = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `org-${randomUUID()}`, name: "Acme Corp" })
        .returning(),
      "org",
    );
    await db
      .update(schema.projectTable)
      .set({ organisationId: org.id })
      .where(eq(schema.projectTable.id, w.project.id));
    const link = await w.ownerCall(`/api/services/${webId}`, {
      method: "PATCH",
      body: { links: [{ kind: "project", projectId: w.project.id }] },
    });
    expect(link.status, await link.clone().text()).toBe(200);

    const impact = await w.ownerCall(`/api/services/${dbSvc.id}/impact`);
    expect(impact.status).toBe(200);
    const body = (await impact.json()) as {
      impacted: { name: string; depth: number; viaName: string }[];
      customers: { name: string }[];
      cycleDetected: boolean;
    };
    expect(body.impacted.map((n) => [n.name, n.depth, n.viaName])).toEqual([
      ["API", 1, "DB"],
      ["Web", 2, "API"],
    ]);
    expect(body.customers.map((c) => c.name)).toEqual(["Acme Corp"]);
    expect(body.cycleDetected).toBe(false);
  });

  it("permits a circular dependency but flags it and stops the walk", async () => {
    const w = await serviceWorld();
    const a = await w.makeService("A");
    const b = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "B",
        dependsOnServiceIds: [a.id],
      },
    });
    const bId = ((await b.json()) as ServiceBody).id;
    const close = await w.ownerCall(`/api/services/${a.id}`, {
      method: "PATCH",
      body: { dependsOnServiceIds: [bId] },
    });
    expect(close.status).toBe(200);
    expect(((await close.json()) as ServiceBody).cycleDetected).toBe(true);
    const impact = await w.ownerCall(`/api/services/${a.id}/impact`);
    const body = (await impact.json()) as {
      impacted: { name: string }[];
      cycleDetected: boolean;
      cycleServiceIds: string[];
    };
    expect(body.impacted.map((n) => n.name)).toEqual(["B"]);
    expect(body.cycleDetected).toBe(true);
    expect(body.cycleServiceIds).toEqual([a.id]);
    const self = await w.ownerCall(`/api/services/${a.id}`, {
      method: "PATCH",
      body: { dependsOnServiceIds: [a.id] },
    });
    expect(self.status).toBe(422);
  });

  it("counts incidents per service from work item references (SVC-3)", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService("Billing");
    const world = await workItemWorld(w.workspaceId, w.project.id);
    const incidentType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: w.workspaceId,
          key: "incident",
          name: "Incident",
          category: "service",
        })
        .returning(),
      "incident type",
    );
    const item = await world.makeItem("Billing is down");
    await db
      .update(schema.workItemTable)
      .set({ typeId: incidentType.id })
      .where(eq(schema.workItemTable.id, item.id));
    const ref = await w.ownerCall(`/api/work-items/${item.key}/service`, {
      method: "POST",
      body: { serviceId: svc.id },
    });
    expect(ref.status, await ref.clone().text()).toBe(200);
    const detail = await w.ownerCall(`/api/services/${svc.id}`);
    expect(((await detail.json()) as ServiceBody).incidentCount).toBe(1);
    const foreign = await w.ownerCall(`/api/work-items/${item.key}/service`, {
      method: "POST",
      body: { serviceId: randomUUID() },
    });
    expect(foreign.status).toBe(422);
  });

  it("deletion is a pending action and is refused while the service has open changes or dependents", async () => {
    const w = await serviceWorld();
    const base = await w.makeService("Base");
    const dependent = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Dependent",
        dependsOnServiceIds: [base.id],
      },
    });
    const dependentId = ((await dependent.json()) as ServiceBody).id;
    const blocked = await w.ownerCall(`/api/services/${base.id}`, {
      method: "DELETE",
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toContain("depend on it");

    const free = await w.ownerCall(`/api/services/${dependentId}`, {
      method: "DELETE",
    });
    expect(free.status, await free.clone().text()).toBe(202);
    // Nothing is deleted until the pending action is approved.
    const still = await w.ownerCall(`/api/services/${dependentId}`);
    expect(still.status).toBe(200);
    const pending = (await free.json()) as { pendingActionId: string };
    const approved = await w.ownerCall(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      { method: "POST", body: {} },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    const gone = await w.ownerCall(`/api/services/${dependentId}`);
    expect(gone.status).toBe(404);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "service.deleted"));
    expect(audit).toHaveLength(1);
  });

  it("refuses deletion while an open change affects the service", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService("Core");
    const world = await workItemWorld(w.workspaceId, w.project.id);
    const changeType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: w.workspaceId,
          key: `chg-${randomUUID().slice(0, 6)}`,
          name: "Change",
          category: "service",
          isChange: true,
        })
        .returning(),
      "change type",
    );
    const item = await world.makeItem("Upgrade core");
    await db
      .update(schema.workItemTable)
      .set({ typeId: changeType.id })
      .where(eq(schema.workItemTable.id, item.id));
    const patch = await w.ownerCall(`/api/work-items/${item.key}/change`, {
      method: "PATCH",
      body: { serviceIds: [svc.id], version: 1 },
    });
    expect(patch.status, await patch.clone().text()).toBe(200);
    const refused = await w.ownerCall(`/api/services/${svc.id}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("open change");
  });
});

describe("service catalogue access", () => {
  it("is off until the feature flag is on", async () => {
    const w = await serviceWorld();
    await setServiceFlag(w.workspaceId, false);
    const response = await w.ownerCall(
      `/api/services?workspaceId=${w.workspaceId}`,
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("feature_disabled");
  });

  it("reports status without refusing a disabled feature, and what the caller may manage", async () => {
    const w = await serviceWorld();
    const url = `/api/service-catalogue/status?workspaceId=${w.workspaceId}`;
    const owner = await w.ownerCall(url);
    expect(await owner.json()).toEqual({
      enabled: true,
      canManageServices: true,
      canManageChanges: true,
      canManageReleases: true,
    });
    const viewer = await w.as(w.viewer.user, url);
    expect(await viewer.json()).toEqual({
      enabled: true,
      canManageServices: false,
      canManageChanges: false,
      canManageReleases: false,
    });
    await setServiceFlag(w.workspaceId, false);
    const off = await w.ownerCall(url);
    expect(off.status).toBe(200);
    expect(((await off.json()) as { enabled: boolean }).enabled).toBe(false);
    const foreign = await w.as(w.stranger.user, url);
    expect(foreign.status).toBe(403);
  });

  it("denies a member without service:manage, lets a viewer read, and refuses a viewer write", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService("Visible");
    const write = await w.as(w.member.user, "/api/services", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Nope" },
    });
    expect(write.status).toBe(403);
    const status = await w.as(w.member.user, `/api/services/${svc.id}/status`, {
      method: "POST",
      body: { status: "outage" },
    });
    expect(status.status).toBe(403);
    const remove = await w.as(w.member.user, `/api/services/${svc.id}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(403);
    const read = await w.as(
      w.viewer.user,
      `/api/services?workspaceId=${w.workspaceId}`,
    );
    expect(read.status, await read.clone().text()).toBe(200);
    const viewerWrite = await w.as(w.viewer.user, "/api/services", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Nope" },
    });
    expect(viewerWrite.status).toBe(403);
  });

  it("isolates tenants: another workspace cannot list, read, change or delete", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService("Private");
    const asStranger = (
      path: string,
      init: { method?: string; body?: unknown } = {},
    ) => w.as(w.stranger.user, path, init);
    const list = await asStranger(`/api/services?workspaceId=${w.workspaceId}`);
    expect(list.status).toBe(403);
    for (const [method, path, body] of [
      ["GET", `/api/services/${svc.id}`, undefined],
      ["GET", `/api/services/${svc.id}/impact`, undefined],
      ["PATCH", `/api/services/${svc.id}`, { name: "Taken" }],
      ["POST", `/api/services/${svc.id}/status`, { status: "outage" }],
      ["DELETE", `/api/services/${svc.id}`, undefined],
    ] as const) {
      const response = await asStranger(path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const write = await asStranger("/api/services", {
      method: "POST",
      body: { workspaceId: w.workspaceId, name: "Intruder" },
    });
    expect(write.status).toBe(403);
  });

  it("refuses a dependency or link that points into another workspace", async () => {
    const w = await serviceWorld();
    const foreignWorkspaceService = await w.as(
      w.stranger.user,
      "/api/services",
      {
        method: "POST",
        body: { workspaceId: w.stranger.workspace.id, name: "Foreign" },
      },
    );
    const foreignId = ((await foreignWorkspaceService.json()) as ServiceBody)
      .id;
    const dep = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Cross",
        dependsOnServiceIds: [foreignId],
      },
    });
    expect(dep.status).toBe(422);
    const link = await w.ownerCall("/api/services", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Cross link",
        links: [{ kind: "project", projectId: randomUUID() }],
      },
    });
    expect(link.status).toBe(422);
  });
});
