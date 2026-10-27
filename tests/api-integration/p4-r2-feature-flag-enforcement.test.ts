import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  customerPortalStateForSubmission,
  featureStateSomewhere,
  invalidateFeatureFlagCache,
  projectFeatureEnabled,
  workspaceFeatureEnabled,
} from "../../apps/api/src/feature-flag/enforce";
import {
  FeatureFlagScopeError,
  patchInstanceFeatures,
  patchWorkspaceFeatures,
  resolveProjectFeatures,
} from "../../apps/api/src/feature-flag/repository";
import { createApp } from "../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import {
  addCustomer,
  buildTenant,
  PORTAL_HOST,
  personOf,
  portalRequest,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";
import { createSeesAllWorkspaceMember } from "./helpers/project-reach-world";

/**
 * P4R2-M2, P4R2-L1, P4R2-L2, P3-R2-03: lower-level overrides are enforced where the contract
 * gives the flag a lower level, refused where it does not, and the portal host tells "off"
 * from "cannot read".
 */

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

async function setWorkspaceFlag(
  workspaceId: string,
  featureKey: string,
  enabled: boolean,
) {
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId, featureKey, enabled })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled },
    });
  invalidateFeatureFlagCache();
}

async function setProjectFlag(
  projectId: string,
  featureKey: string,
  enabled: boolean | null,
) {
  if (enabled === null)
    await db
      .delete(schema.projectFeatureFlagTable)
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, projectId),
          eq(schema.projectFeatureFlagTable.featureKey, featureKey),
        ),
      );
  else
    await db
      .insert(schema.projectFeatureFlagTable)
      .values({ projectId, featureKey, enabled })
      .onConflictDoUpdate({
        target: [
          schema.projectFeatureFlagTable.projectId,
          schema.projectFeatureFlagTable.featureKey,
        ],
        set: { enabled },
      });
  invalidateFeatureFlagCache();
}

function agentRequest(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  init?: RequestInit,
) {
  const r = withConfiguredAgentAuthority(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return app.request(r.input, r.init);
}

const actor = (personId: string, userId: string) => ({ userId, personId });

describe("instance-only flags: feature.scim and feature.mcp (P4R2-M2)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("refuses workspace and project overrides with 422, stores nothing, hides them from the lower-level lists and ignores stale rows", async () => {
    const { user, workspace } = await createSeesAllWorkspaceMember({
      role: "owner",
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    mockAuthenticatedSession(user);
    const { app } = createApp();

    for (const key of ["feature.scim", "feature.mcp"]) {
      const workspaceWrite = await agentRequest(
        app,
        `/api/workspaces/${workspace.id}/features`,
        {
          method: "PATCH",
          body: JSON.stringify({ changes: [{ key, enabled: false }] }),
        },
      );
      expect(workspaceWrite.status).toBe(422);
      expect(await workspaceWrite.json()).toEqual({
        message: "feature_instance_only",
        key,
      });
      const projectWrite = await agentRequest(
        app,
        `/api/projects/${project.id}/features`,
        {
          method: "PATCH",
          body: JSON.stringify({ changes: [{ key, enabled: true }] }),
        },
      );
      expect(projectWrite.status).toBe(422);
    }
    expect(
      await db
        .select()
        .from(schema.workspaceFeatureFlagTable)
        .where(eq(schema.workspaceFeatureFlagTable.workspaceId, workspace.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.projectFeatureFlagTable)
        .where(eq(schema.projectFeatureFlagTable.projectId, project.id)),
    ).toEqual([]);
    const audits = await db
      .select({ id: schema.auditLogTable.id })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "feature_flag.changed"));
    expect(audits).toEqual([]);

    // The workspace and project panels never offer them.
    for (const path of [
      `/api/workspaces/${workspace.id}/features`,
      `/api/projects/${project.id}/features`,
    ]) {
      const list = await agentRequest(app, path);
      expect(list.status).toBe(200);
      const keys = (
        (await list.json()) as { features: { key: string }[] }
      ).features.map((feature) => feature.key);
      expect(keys).not.toContain("feature.scim");
      expect(keys).not.toContain("feature.mcp");
      expect(keys).toContain("feature.sla");
    }

    // A lower row stored before this rule existed is ignored everywhere.
    await setInstanceFlag("feature.scim", true);
    await setWorkspaceFlag(workspace.id, "feature.scim", false);
    await setProjectFlag(project.id, "feature.scim", false);
    const resolved = await resolveProjectFeatures(project.id, workspace.id);
    expect(resolved.find((f) => f.key === "feature.scim")).toMatchObject({
      enabled: true,
      source: "instance",
    });
    const scim = await app.request("/scim/v2/Users", {
      headers: { authorization: `Bearer ${"x".repeat(43)}` },
    });
    expect(scim.status).toBe(401);
  });

  it("the repository refuses an instance-only change even with other valid changes in the batch", async () => {
    const { user, workspace } = await createSeesAllWorkspaceMember({
      role: "owner",
    });
    const person = await personOf(user.id);
    await expect(
      patchWorkspaceFeatures(
        workspace.id,
        [
          { key: "feature.cycles", enabled: true },
          { key: "feature.mcp", enabled: true },
        ],
        actor(person.id, user.id),
      ),
    ).rejects.toBeInstanceOf(FeatureFlagScopeError);
    expect(
      await db
        .select()
        .from(schema.workspaceFeatureFlagTable)
        .where(eq(schema.workspaceFeatureFlagTable.workspaceId, workspace.id)),
    ).toEqual([]);
  });
});

describe("resolution parity: settings view equals enforcement (P4R2-M2)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("resolveProjectFeatures and the enforce helpers agree across instance, workspace and project rows", async () => {
    const { workspace } = await createSeesAllWorkspaceMember({
      role: "owner",
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const cases: Array<{
      instance: boolean;
      workspace: boolean | null;
      project: boolean | null;
    }> = [];
    for (const instance of [false, true])
      for (const ws of [null, false, true])
        for (const pr of [null, false, true])
          cases.push({ instance, workspace: ws, project: pr });
    for (const c of cases) {
      await setInstanceFlag("feature.sla", c.instance);
      if (c.workspace === null)
        await db
          .delete(schema.workspaceFeatureFlagTable)
          .where(
            eq(schema.workspaceFeatureFlagTable.workspaceId, workspace.id),
          );
      else await setWorkspaceFlag(workspace.id, "feature.sla", c.workspace);
      await setProjectFlag(project.id, "feature.sla", c.project);
      const view = (
        await resolveProjectFeatures(project.id, workspace.id)
      ).find((f) => f.key === "feature.sla");
      const expected = c.project ?? c.workspace ?? c.instance;
      expect(view?.enabled, JSON.stringify(c)).toBe(expected);
      expect(
        await projectFeatureEnabled("feature.sla", project.id),
        JSON.stringify(c),
      ).toBe(expected);
      expect(
        await workspaceFeatureEnabled("feature.sla", workspace.id),
        JSON.stringify(c),
      ).toBe(c.workspace ?? c.instance);
    }
  });
});

describe("flag reads inside a transaction (P4R2-L2)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a failing read answers off and leaves the caller's transaction usable", async () => {
    const { workspace } = await createSeesAllWorkspaceMember({
      role: "owner",
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const rollback = new Error("rollback");
    await expect(
      db.transaction(async (tx) => {
        // Make every flag read in this transaction fail; the rename rolls back with it.
        await tx.execute(
          sql`ALTER TABLE instance_feature_flag RENAME TO instance_feature_flag_p4r2_l2`,
        );
        expect(
          await workspaceFeatureEnabled("feature.sla", workspace.id, tx),
        ).toBe(false);
        expect(await projectFeatureEnabled("feature.sla", project.id, tx)).toBe(
          false,
        );
        const after = await tx.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
        expect(after.rows[0]?.ok).toBe(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await workspaceFeatureEnabled("feature.sla", workspace.id)).toBe(
      true,
    );
  });
});

describe("customer portal host (P4R2-L1, P3-R2-03)", () => {
  let portalRoot: string;
  beforeAll(() => {
    portalRoot = mkdtempSync(join(tmpdir(), "taskdesk-p4r2-portal-"));
    mkdirSync(join(portalRoot, "assets"));
    writeFileSync(
      join(portalRoot, "index.html"),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>',
    );
    writeFileSync(join(portalRoot, "assets", "app.js"), "export {};\n");
  });
  afterAll(() => {
    rmSync(portalRoot, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetTestDatabase();
    await db
      .insert(schema.instanceSettingTable)
      .values({ id: "singleton", setupCompletedAt: new Date() })
      .onConflictDoNothing();
  });

  const portal = (
    app: ReturnType<typeof createApp>["app"],
    path: string,
    init: RequestInit = {},
  ) =>
    app.request(path, {
      ...init,
      headers: { host: PORTAL_HOST, ...init.headers },
    });

  it("off: the portal app is served with the disabled marker (404), its assets load, the API answers 404", async () => {
    const { app } = createApp({ portalStaticRoot: portalRoot });
    await setInstanceFlag("feature.customer_portal", false);
    const page = await portal(app, "/requests");
    expect(page.status).toBe(404);
    expect(page.headers.get("cache-control")).toContain("no-store");
    const html = await page.text();
    expect(html).toContain(
      '<meta name="taskdesk-portal-state" content="disabled">',
    );
    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain("Customer portal unavailable");
    const asset = await portal(app, "/assets/app.js");
    expect(asset.status).toBe(200);
    const api = await portal(app, "/api/public/terminology");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ message: "Not found" });
    // CP-19 still holds: an unregistered path is a plain 404, never the shell.
    const unknown = await portal(app, "/not-a-portal-route");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).not.toContain("taskdesk-portal-state");
    // A project switched on inside an off instance brings the host back.
    const { workspace } = await createSeesAllWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await setProjectFlag(project.id, "feature.customer_portal", true);
    const on = await portal(app, "/requests");
    expect(on.status).toBe(200);
    expect(await on.text()).not.toContain("taskdesk-portal-state");
  });

  it("a flag lookup failure answers 503 temporarily unavailable, not the disabled 404", async () => {
    const { app } = createApp({ portalStaticRoot: portalRoot });
    invalidateFeatureFlagCache();
    await db.execute(
      sql`ALTER TABLE instance_feature_flag RENAME TO instance_feature_flag_p4r2_l1`,
    );
    try {
      expect(await featureStateSomewhere("feature.customer_portal")).toBe(
        "unknown",
      );
      const api = await portal(app, "/api/public/terminology");
      expect(api.status).toBe(503);
      expect(api.headers.get("retry-after")).toBe("5");
      expect(await api.json()).toEqual({ message: "temporarily_unavailable" });
      const page = await portal(app, "/");
      expect(page.status).toBe(503);
      expect(await page.text()).toContain(
        '<meta name="taskdesk-portal-state" content="unavailable">',
      );
    } finally {
      await db.execute(
        sql`ALTER TABLE instance_feature_flag_p4r2_l1 RENAME TO instance_feature_flag`,
      );
      invalidateFeatureFlagCache();
    }
    // "unknown" is never cached: the next request reads again.
    expect(await featureStateSomewhere("feature.customer_portal")).toBe("on");
  });

  it("caches the lookup for a few seconds and a flag write in this process clears it", async () => {
    invalidateFeatureFlagCache();
    expect(await featureStateSomewhere("feature.customer_portal")).toBe("on");
    // A write that bypasses the repository is not seen until the cache expires...
    await db
      .update(schema.instanceFeatureFlagTable)
      .set({ enabled: false })
      .where(
        eq(
          schema.instanceFeatureFlagTable.featureKey,
          "feature.customer_portal",
        ),
      );
    expect(await featureStateSomewhere("feature.customer_portal")).toBe("on");
    // ...while a write through the flag repository applies at once.
    const { user } = await createSeesAllWorkspaceMember({ role: "owner" });
    const person = await personOf(user.id);
    await patchInstanceFeatures(
      [{ key: "feature.cycles", enabled: true }],
      actor(person.id, user.id),
    );
    expect(await featureStateSomewhere("feature.customer_portal")).toBe("off");
  });
});

describe("feature.customer_portal per customer organisation (P4R2-M2)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: "feature.intake", enabled: true })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: true },
      });
    invalidateFeatureFlagCache();
  });

  it("a customer's portal data routes follow the flag resolved for their organisation's projects, while the host stays up", async () => {
    const tenant = await buildTenant("p4r2-portal-org");
    const customer = await addCustomer(tenant);
    const backlog = () =>
      portalRequest(tenant, customer, "/api/portal/requests/backlog");
    expect((await backlog()).status).toBe(200);

    // The customer's only engaged workspace switches the portal off; another workspace keeps
    // it on, so the host still answers.
    await setWorkspaceFlag(
      tenant.workspaceId,
      "feature.customer_portal",
      false,
    );
    const other = await createSeesAllWorkspaceMember({ role: "owner" });
    await setWorkspaceFlag(other.workspace.id, "feature.customer_portal", true);
    expect(await featureStateSomewhere("feature.customer_portal")).toBe("on");
    const off = await backlog();
    expect(off.status).toBe(404);
    expect(await off.json()).toEqual({ message: "Not found" });
    // Sign-in level routes stay open so the portal app can load and show its state.
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const terminology = await tenant.app.request(
      `http://${PORTAL_HOST}/api/portal/terminology`,
      { headers: { host: PORTAL_HOST } },
    );
    expect(terminology.status).not.toBe(404);

    // A project override decides for that project's customers.
    await setProjectFlag(tenant.project.id, "feature.customer_portal", true);
    expect((await backlog()).status).toBe(200);
    await setWorkspaceFlag(tenant.workspaceId, "feature.customer_portal", true);
    await setProjectFlag(tenant.project.id, "feature.customer_portal", false);
    expect((await backlog()).status).toBe(404);
  });

  it("a submission follows its own workspace's flag", async () => {
    const tenant = await buildTenant("p4r2-portal-submission");
    const customer = await addCustomer(tenant);
    const [requestType] = await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: tenant.workspaceId,
        key: `p4r2-${randomUUID()}`,
        name: "Portal request",
        group: "General",
        workItemTypeId: tenant.type.id,
        formSchema: { fields: [] },
        published: true,
        customerVisible: true,
      })
      .returning();
    if (!requestType) throw new Error("request type missing");
    const [version] = await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: tenant.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: tenant.type.id,
      })
      .returning();
    if (!version) throw new Error("request type version missing");
    const submission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: customer.orgId,
          requesterId: customer.person.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: {},
          state: "new",
          submittedAt: new Date(),
          customerVisibility: "organisation",
        })
        .returning(),
      "submission",
    );
    expect(await customerPortalStateForSubmission(submission.number)).toBe(
      "on",
    );
    await setWorkspaceFlag(
      tenant.workspaceId,
      "feature.customer_portal",
      false,
    );
    expect(await customerPortalStateForSubmission(submission.number)).toBe(
      "off",
    );
    // An unknown reference is left to the route's own not-found.
    expect(await customerPortalStateForSubmission(999_999_999)).toBe("on");
  });
});
