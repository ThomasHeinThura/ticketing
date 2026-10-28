/**
 * P5 reports, the core: every route refuses a customer with 403 (RP-18), the honesty rule
 * (RP-1..RP-6), reach filtering (RP-17), tenant isolation and the filter state in the URL (RP-8).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { reportPolicies } from "../../apps/api/src/report/policy";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  daysAgo,
  type ReportsWorld,
  reportsWorld,
  setFeature,
} from "./helpers/p5-reports";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
});

function concrete(route: string) {
  const [method, path] = route.split(" ") as [string, string];
  return {
    method,
    path: path
      .replace("{key}", "throughput")
      .replace("{wid}", "widget-x")
      .replace("{id}", "dashboard-x"),
  };
}

describe("customers see no reports (RP-18)", () => {
  it("answers 403 on every report and dashboard route, with the feature on and off", async () => {
    const routes = Object.keys(reportPolicies);
    expect(routes.length).toBeGreaterThanOrEqual(11);
    for (const enabled of [true, false]) {
      await setFeature(w.workspaceId, "feature.reports", enabled);
      for (const route of routes) {
        const { method, path } = concrete(route);
        for (const options of [undefined, { portal: "customer" as const }]) {
          if (options) mockAuthenticatedSession(w.customer.user, options);
          else mockAuthenticatedSession(w.customer.user);
          const separator = path.includes("?") ? "&" : "?";
          const response = await w.app.request(
            method === "GET"
              ? `${path}${separator}workspaceId=${w.workspaceId}`
              : path,
            {
              method,
              headers: { "content-type": "application/json" },
              ...(method === "GET" || method === "DELETE"
                ? {}
                : {
                    body: JSON.stringify({
                      workspaceId: w.workspaceId,
                      query: {},
                      name: "x",
                      version: 1,
                    }),
                  }),
            },
          );
          // A portal-flagged session on the agent host is turned away earlier by the agent/portal
          // separation (401); a plain customer session reaches the route and is refused with 403.
          if (options)
            expect(
              [401, 403],
              `${route} portal -> ${response.status}`,
            ).toContain(response.status);
          else
            expect(
              response.status,
              `${route} (feature ${enabled}) -> ${response.status}`,
            ).toBe(403);
        }
      }
    }
  });

  it("turns away an agent session that is staff on a route without report:read being the problem: staff get 409 when the feature is off", async () => {
    await setFeature(w.workspaceId, "feature.reports", false);
    const { response } = await w.report(w.owner.user, "throughput");
    expect(response.status).toBe(409);
  });

  it("refuses export without report:export and allows it for a lead", async () => {
    const body = { workspaceId: w.workspaceId };
    const member = await w.get(
      w.member.user,
      "/api/reports/throughput/export",
      { method: "POST", body },
    );
    expect(member.status).toBe(403);
    const lead = await w.get(w.lead.user, "/api/reports/throughput/export", {
      method: "POST",
      body,
    });
    expect(lead.status).toBe(200);
  });
});

describe("the honesty rule", () => {
  it("returns null with its sample, never 0% or 100%, below the minimum (RP-1)", async () => {
    for (let i = 0; i < 3; i += 1)
      await w.addItem({
        createdDaysAgo: 5,
        resolvedDaysAgo: 2,
        sla: { state: "met" },
      });
    const { body } = await w.report(w.owner.user, "sla_attainment");
    const attainment = body.metrics.find(
      (metric) => metric.key === "attainment",
    );
    expect(attainment?.value).toBeNull();
    expect(attainment?.n).toBe(3);
    expect(attainment?.needed).toBe(10);
    for (const row of body.rows)
      expect(row.attainment).toEqual({ n: 3, needed: 10 });
  });

  it("reports a rate once the sample reaches the minimum (RP-1)", async () => {
    for (let i = 0; i < 9; i += 1)
      await w.addItem({
        createdDaysAgo: 5,
        resolvedDaysAgo: 2,
        sla: { state: "met" },
      });
    await w.addItem({
      createdDaysAgo: 5,
      resolvedDaysAgo: 2,
      sla: { state: "missed" },
    });
    const { body } = await w.report(w.owner.user, "sla_attainment");
    expect(body.metrics.find((m) => m.key === "attainment")?.value).toBe(90);
  });

  it("shows age as buckets and no mean (RP-2)", async () => {
    const before = await w.report(w.owner.user, "ageing");
    const base = Object.fromEntries(
      before.body.rows.map((row) => [row.bucket, row.items]),
    );
    await w.addItem({ createdDaysAgo: 0 });
    await w.addItem({ createdDaysAgo: 100 });
    await w.addItem({ createdDaysAgo: 5 });
    const { body } = await w.report(w.owner.user, "ageing");
    const counts = Object.fromEntries(
      body.rows.map((row) => [row.bucket, row.items]),
    );
    expect(Number(counts["< 1 day"]) - Number(base["< 1 day"])).toBe(1);
    expect(Number(counts["4-7 days"]) - Number(base["4-7 days"])).toBe(1);
    expect(Number(counts["> 90 days"]) - Number(base["> 90 days"])).toBe(1);
    expect(body.columns.map((column) => column.key)).not.toContain("mean");
  });

  it("states scope, window and as-of time (RP-3, RP-4)", async () => {
    await w.addItem({ createdDaysAgo: 1 });
    const { body } = await w.report(w.member.user, "workload", "&window=7");
    expect(body.scope.kind).toBe("reach");
    expect(body.scope.projectCount).toBe(1);
    const all = await w.report(w.owner.user, "workload", "&window=7");
    expect(all.body.scope.kind).toBe("all");
    expect(all.body.scope.projectCount).toBeGreaterThanOrEqual(2);
    expect(body.window.live).toBe(true);
    expect(new Date(body.asOf).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const dated = await w.report(w.owner.user, "throughput", "&window=7");
    expect(dated.body.window).toMatchObject({
      preset: "7",
      days: 7,
      live: false,
    });
  });

  it("shows an empty population as empty with the total outside the window (RP-5)", async () => {
    await w.addItem({ createdDaysAgo: 80, resolvedDaysAgo: 70 });
    const { body } = await w.report(w.owner.user, "throughput", "&window=7");
    expect(body.empty).toEqual({
      reason: "no_data_in_window",
      outsideWindow: 1,
      excluded: null,
    });
    expect(body.chart).toBeNull();
    expect(body.rows).toEqual([]);
  });

  it("draws no trend arrow without two comparable periods and draws one with them (RP-6)", async () => {
    await w.addItem({ createdDaysAgo: 3, resolvedDaysAgo: 1 });
    const alone = await w.report(w.owner.user, "throughput", "&window=7");
    expect(alone.body.metrics[0]?.trend).toEqual({
      status: "ok",
      direction: "up",
      delta: 1,
      previous: 0,
    });
    const sla = await w.report(w.owner.user, "sla_attainment", "&window=7");
    expect(sla.body.metrics.find((m) => m.key === "attainment")?.trend).toEqual(
      {
        status: "insufficient",
        reason: "needs_two_periods",
      },
    );
  });

  it("rejects an invalid or oversized custom window", async () => {
    const bad = await w.get(
      w.owner.user,
      `/api/reports/throughput?workspaceId=${w.workspaceId}&window=custom&from=2026-01-01&to=2027-06-01`,
    );
    expect(bad.status).toBe(422);
    const order = await w.get(
      w.owner.user,
      `/api/reports/throughput?workspaceId=${w.workspaceId}&window=custom&from=2026-02-01&to=2026-01-01`,
    );
    expect(order.status).toBe(422);
    const unknown = await w.get(
      w.owner.user,
      `/api/reports/nope?workspaceId=${w.workspaceId}`,
    );
    expect(unknown.status).toBe(404);
  });
});

describe("reach and tenancy (RP-17)", () => {
  it("shows two people different numbers and says why", async () => {
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectA.id,
    });
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectB.id,
    });
    const owner = await w.report(w.owner.user, "throughput", "&window=7");
    const member = await w.report(w.member.user, "throughput", "&window=7");
    const outsider = await w.report(w.outsider.user, "throughput", "&window=7");
    expect(owner.body.metrics[0]?.value).toBe(2);
    expect(member.body.metrics[0]?.value).toBe(1);
    expect(outsider.body.metrics[0]?.value).toBe(0);
    expect(member.body.scope.kind).toBe("reach");
    expect(outsider.body.scope.projectCount).toBe(0);
  });

  it("widens to the whole workspace with report:read_all and never past it", async () => {
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectB.id,
    });
    // A work item in another workspace must not appear for anyone.
    const lead = await w.report(w.lead.user, "throughput", "&window=7");
    expect(lead.body.metrics[0]?.value).toBe(0);
    expect(lead.body.scope.kind).toBe("reach");
    const owner = await w.report(w.owner.user, "throughput", "&window=7");
    expect(owner.body.metrics[0]?.value).toBe(1);
    const strangerRows = await w.get(
      w.stranger.user,
      `/api/reports/throughput?workspaceId=${w.stranger.workspace.id}&window=7`,
    );
    expect(strangerRows.status).toBe(200);
    const stranger = (await strangerRows.json()) as {
      metrics: Array<{ value: number }>;
      scope: { kind: string };
    };
    expect(stranger.metrics[0]?.value).toBe(0);
    expect(stranger.scope.kind).toBe("all");
  });

  it("refuses a workspace the caller is not in", async () => {
    const response = await w.get(
      w.stranger.user,
      `/api/reports/throughput?workspaceId=${w.workspaceId}`,
    );
    expect([403, 404]).toContain(response.status);
  });

  it("filters by project and keeps the filter in the response (RP-7, RP-8)", async () => {
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectA.id,
    });
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectB.id,
    });
    const { body } = await w.report(
      w.owner.user,
      "throughput",
      `&window=7&projectId=${w.projectB.id}`,
    );
    expect(body.metrics[0]?.value).toBe(1);
    expect(body.filters).toEqual({ projectId: w.projectB.id });
    const priority = await w.report(
      w.owner.user,
      "throughput",
      "&window=7&priority=urgent",
    );
    expect(priority.body.metrics[0]?.value).toBe(0);
  });

  it("drills from a number to the same filtered list (RP-12)", async () => {
    const item = await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectA.id,
    });
    await w.addItem({
      createdDaysAgo: 3,
      resolvedDaysAgo: 1,
      projectId: w.projectB.id,
    });
    const response = await w.get(
      w.member.user,
      `/api/reports/throughput/items?workspaceId=${w.workspaceId}&window=7`,
    );
    const body = (await response.json()) as { data: Array<{ key: string }> };
    expect(body.data.map((entry) => entry.key)).toEqual([item.key]);
  });
});

describe("the report set", () => {
  it("runs every tier 1 report without error for the owner and for a member", async () => {
    const list = await w.get(
      w.owner.user,
      `/api/reports?workspaceId=${w.workspaceId}`,
    );
    expect(list.status).toBe(200);
    const catalogue = (await list.json()) as { data: Array<{ key: string }> };
    expect(catalogue.data.length).toBeGreaterThanOrEqual(20);
    await w.addItem({
      createdDaysAgo: 40,
      resolvedDaysAgo: 3,
      priority: "high",
      sla: { state: "missed" },
    });
    await w.addItem({
      createdDaysAgo: 4,
      priority: "urgent",
      sla: { state: "at_risk" },
      assigneeId: w.ownerPersonId,
    });
    for (const user of [w.owner.user, w.member.user, w.lead.user]) {
      for (const { key } of catalogue.data) {
        const { response, body } = await w.report(user, key, "&window=30");
        expect(response.status, `${key}: ${JSON.stringify(body)}`).toBe(200);
        expect(body.key).toBe(key);
      }
    }
  });
});

void daysAgo;
