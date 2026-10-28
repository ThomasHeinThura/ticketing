/**
 * P4 lane requests applied in P5-owned files (feature flags at workspace and project scope):
 *  - the portal knowledge base hides articles whose workspace or project has
 *    `feature.customer_portal` off (kb/visibility.ts);
 *  - portal release notes need the portal on for the workspace and for the linked project that
 *    carries the organisation's reach (service-management/release-portal.ts);
 *  - SLA reports run when any project switches `feature.sla` on, and count only those projects'
 *    rows (report/feature-scope.ts).
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  releaseTable,
  serviceLinkTable,
  serviceTable,
} from "../../apps/api/src/database/schema-p5-service";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { resetTestDatabase } from "./helpers/database";
import {
  insertArticle,
  type KbWorld,
  kbWorld,
  setKbFlag,
} from "./helpers/p5-kb";
import { reportsWorld, setFeature } from "./helpers/p5-reports";
import { setServiceFlag } from "./helpers/p5-service";

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
  enabled: boolean,
) {
  await db
    .delete(schema.projectFeatureFlagTable)
    .where(
      and(
        eq(schema.projectFeatureFlagTable.projectId, projectId),
        eq(schema.projectFeatureFlagTable.featureKey, featureKey),
      ),
    );
  await db
    .insert(schema.projectFeatureFlagTable)
    .values({ projectId, featureKey, enabled });
  invalidateFeatureFlagCache();
}

beforeEach(async () => {
  await resetTestDatabase();
  invalidateFeatureFlagCache();
});

describe("portal knowledge base follows feature.customer_portal", () => {
  let w: KbWorld;
  beforeEach(async () => {
    w = await kbWorld();
    await setKbFlag(w.workspaceId, true);
    await setWorkspaceFlag(w.workspaceId, "feature.customer_portal", true);
  });

  async function listed() {
    const response = await w.portal(w.customerA.user, "/api/portal/kb");
    if (response.status !== 200) return [];
    const body = (await response.json()) as { articles: Array<{ id: string }> };
    return body.articles.map((row) => row.id);
  }

  it("a project override that switches the portal off hides that project's articles only", async () => {
    const general = await insertArticle(w.workspaceId, {
      title: "General article",
      state: "published",
      customerVisible: true,
    });
    const scoped = await insertArticle(w.workspaceId, {
      title: "Project A article",
      state: "published",
      customerVisible: true,
      projectId: w.projectA.id,
    });
    expect((await listed()).sort()).toEqual([general.id, scoped.id].sort());

    // The organisation keeps a project with the portal on, so the portal itself stays open.
    await db
      .update(schema.projectTable)
      .set({ organisationId: w.customerA.orgId })
      .where(eq(schema.projectTable.id, w.projectB.id));
    await setProjectFlag(w.projectA.id, "feature.customer_portal", false);
    expect(await listed()).toEqual([general.id]);
    expect(
      (await w.portal(w.customerA.user, `/api/portal/kb/${scoped.id}`)).status,
    ).toBe(404);
  });

  it("the workspace switched off hides its articles, unless a project switches it back on", async () => {
    const general = await insertArticle(w.workspaceId, {
      title: "General article",
      state: "published",
      customerVisible: true,
    });
    const scoped = await insertArticle(w.workspaceId, {
      title: "Project A article",
      state: "published",
      customerVisible: true,
      projectId: w.projectA.id,
    });
    await setWorkspaceFlag(w.workspaceId, "feature.customer_portal", false);
    expect(await listed()).not.toContain(general.id);
    await setProjectFlag(w.projectA.id, "feature.customer_portal", true);
    const now = await listed();
    expect(now).not.toContain(general.id);
    expect(now).toContain(scoped.id);
  });
});

describe("portal release notes follow feature.customer_portal", () => {
  let w: KbWorld;
  beforeEach(async () => {
    w = await kbWorld();
    await setServiceFlag(w.workspaceId, true);
    await setWorkspaceFlag(w.workspaceId, "feature.customer_portal", true);
    const serviceId = "release-flag-service";
    await db.insert(serviceTable).values({
      id: serviceId,
      workspaceId: w.workspaceId,
      name: "Customer service",
    });
    await db.insert(serviceLinkTable).values({
      workspaceId: w.workspaceId,
      serviceId,
      kind: "project",
      projectId: w.projectA.id,
    });
    const publishedAt = new Date("2030-01-01T12:00:00.000Z");
    await db.insert(releaseTable).values({
      id: "release-flagged",
      workspaceId: w.workspaceId,
      name: "Release flagged",
      serviceId,
      status: "released",
      publishToPortal: true,
      publishedAt,
      portalSnapshot: {
        version: 1,
        name: "Release flagged",
        serviceName: "Customer service",
        plannedDate: null,
        notes: null,
        publishedAt: publishedAt.toISOString(),
      },
    });
  });

  async function listed() {
    const response = await w.portal(w.customerA.user, "/api/portal/releases");
    if (response.status !== 200) return [];
    const body = (await response.json()) as { data: Array<{ id: string }> };
    return body.data.map((row) => row.id);
  }

  it("is listed while the portal is on for the workspace and the linked project", async () => {
    expect(await listed()).toEqual(["release-flagged"]);
  });

  it("the linked project switched off removes the organisation's path to the release", async () => {
    // The organisation keeps another project with the portal on, so the portal stays open.
    await db
      .update(schema.projectTable)
      .set({ organisationId: w.customerA.orgId })
      .where(eq(schema.projectTable.id, w.projectB.id));
    await setProjectFlag(w.projectA.id, "feature.customer_portal", false);
    const response = await w.portal(w.customerA.user, "/api/portal/releases");
    expect(response.status).toBe(200);
    expect(await listed()).toEqual([]);
    expect(
      (await w.portal(w.customerA.user, "/api/portal/releases/release-flagged"))
        .status,
    ).toBe(404);
  });

  it("the workspace switched off hides its releases", async () => {
    await setWorkspaceFlag(w.workspaceId, "feature.customer_portal", false);
    expect(await listed()).toEqual([]);
  });
});

describe("SLA reports follow feature.sla at project scope", () => {
  it("runs when only a project switches SLA on, and counts that project's rows only", async () => {
    const w = await reportsWorld();
    const inA = await w.addItem({
      createdDaysAgo: 2,
      sla: { state: "at_risk" },
      projectId: w.projectA.id,
    });
    const inB = await w.addItem({
      createdDaysAgo: 2,
      sla: { state: "at_risk" },
      projectId: w.projectB.id,
    });
    await setFeature(w.workspaceId, "feature.sla", true);
    invalidateFeatureFlagCache();
    const both = await w.report(w.owner.user, "at_risk_now");
    expect(both.response.status).toBe(200);
    const keysOf = (rows: Array<Record<string, unknown>>) =>
      rows.map((row) => row.key);
    expect(keysOf(both.body.rows)).toEqual(
      expect.arrayContaining([inA.key, inB.key]),
    );

    await setWorkspaceFlag(w.workspaceId, "feature.sla", false);
    expect((await w.report(w.owner.user, "at_risk_now")).response.status).toBe(
      409,
    );

    await setProjectFlag(w.projectA.id, "feature.sla", true);
    const onlyA = await w.report(w.owner.user, "at_risk_now");
    expect(onlyA.response.status).toBe(200);
    expect(keysOf(onlyA.body.rows)).toContain(inA.key);
    expect(keysOf(onlyA.body.rows)).not.toContain(inB.key);

    // The workspace on with project B switched off: B's rows leave the report.
    await setWorkspaceFlag(w.workspaceId, "feature.sla", true);
    await setProjectFlag(w.projectB.id, "feature.sla", false);
    const withoutB = await w.report(w.owner.user, "at_risk_now");
    expect(withoutB.response.status).toBe(200);
    expect(keysOf(withoutB.body.rows)).toContain(inA.key);
    expect(keysOf(withoutB.body.rows)).not.toContain(inB.key);

    // The report list marks SLA reports available while any project has SLA on.
    const list = await w.get(
      w.owner.user,
      `/api/reports?workspaceId=${w.workspaceId}`,
    );
    const reports = (await list.json()) as {
      data: Array<{ key: string; available: boolean }>;
    };
    expect(
      reports.data.find((report) => report.key === "at_risk_now")?.available,
    ).toBe(true);
  });
});
