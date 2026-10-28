/**
 * P5 agile planning, estimates: one system per project and an editable scale (ES-1), points stored
 * as references (ES-2), the system-change preview matching the result (ES-3), roll-up (ES-4),
 * unestimated reported not zeroed (ES-5), the mid-cycle discontinuity, flag-off behaviour,
 * permission and tenant denial.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  estimatePointTable,
  estimateTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { resetTestDatabase } from "./helpers/database";
import {
  type AgileWorld,
  agileWorld,
  auditActionsFor,
  setAgileFlags,
} from "./helpers/p5-agile";

let w: AgileWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await agileWorld();
});

type Point = { id: string; key: string; value: string; weight: number | null };
type Config = {
  system: string | null;
  estimateId: string | null;
  points: Point[];
  canManage: boolean;
};
type Preview = {
  fromSystem: string | null;
  toSystem: string;
  mappedItems: number;
  clearedItems: number;
  mapping: Array<{
    fromValue: string;
    toValue: string | null;
    itemCount: number;
  }>;
  activeCycles: Array<{ id: string }>;
};
type Patched = { applied: boolean; preview: Preview; estimate: Config };

const estimatesPath = () => `/api/projects/${w.project.slug}/estimates`;
const getConfig = async () =>
  w.json<Config>(await w.call(w.manager.user, estimatesPath()));
const patch = (body: Record<string, unknown>, user = w.manager.user) =>
  w.call(user, estimatesPath(), { method: "PATCH", body });
const setEstimate = (
  key: string,
  estimatePointId: string | null,
  user = w.manager.user,
) =>
  w.call(user, `/api/work-items/${key}/estimate`, {
    method: "PUT",
    body: { estimatePointId },
  });
const pointOf = (config: Config, value: string) =>
  config.points.find((p) => p.value === value) as Point;
const pointIdOf = async (itemId: string) =>
  (
    await db
      .select({ id: schema.workItemTable.estimatePointId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, itemId))
  )[0]?.id ?? null;

async function configurePoints() {
  const result = await w.json<Patched>(await patch({ system: "points" }));
  expect(result.applied).toBe(true);
  return result.estimate;
}

describe("choosing the system (ES-1)", () => {
  it("starts with none, then adopts the default Fibonacci scale", async () => {
    expect(await getConfig()).toMatchObject({ system: null, points: [] });
    const config = await configurePoints();
    expect(config.system).toBe("points");
    expect(config.points.map((p) => p.value)).toEqual([
      "1",
      "2",
      "3",
      "5",
      "8",
      "13",
      "21",
    ]);
    expect(config.points.map((p) => p.weight)).toEqual([1, 2, 3, 5, 8, 13, 21]);
    expect(await auditActionsFor(config.estimateId as string)).toContain(
      "estimate.system_changed",
    );
  });

  it("offers categories and time scales", async () => {
    const cat = await w.json<Patched>(await patch({ system: "categories" }));
    expect(cat.estimate.points.map((p) => p.value)).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
    ]);
    expect(cat.estimate.points.every((p) => p.weight === null)).toBe(true);
    const time = await w.json<Patched>(await patch({ system: "time" }));
    expect(time.estimate.points.map((p) => p.value)).toEqual([
      "1h",
      "2h",
      "4h",
      "1d",
      "2d",
      "1w",
    ]);
    expect(time.estimate.points[3]?.weight).toBe(480);
  });

  it("allows at most one active system (database guard)", async () => {
    const config = await configurePoints();
    await expect(
      db.insert(estimateTable).values({
        workspaceId: w.workspaceId,
        projectId: w.project.id,
        system: "time",
        active: true,
      }),
    ).rejects.toThrow();
    expect(config.estimateId).toBeTruthy();
  });

  it("validates a scale", async () => {
    await configurePoints();
    expect(
      (await patch({ system: "points", points: [{ value: "abc" }] })).status,
    ).toBe(422);
    expect(
      (
        await patch({
          system: "points",
          points: [{ value: "2" }, { value: "2" }],
        })
      ).status,
    ).toBe(422);
    expect(
      (await patch({ system: "categories", points: [{ value: " " }] })).status,
    ).toBe(400);
    expect((await patch({})).status).toBe(400);
  });
});

describe("setting an estimate and the roll-up (ES-2, ES-4, ES-5)", () => {
  it("stores a reference to a point row and refuses points outside the scale", async () => {
    const config = await configurePoints();
    const item = await w.items.makeItem("Item");
    const five = pointOf(config, "5");
    const set = await w.json<{ estimatePointId: string; point: Point }>(
      await setEstimate(item.key, five.id),
    );
    expect(set.estimatePointId).toBe(five.id);
    expect(await pointIdOf(item.id)).toBe(five.id);
    // a point of a different project's estimate is refused
    const otherConfig = await w.json<Patched>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.otherProject.slug}/estimates`,
        {
          method: "PATCH",
          body: { system: "points" },
        },
      ),
    );
    const foreignPoint = otherConfig.estimate.points[0] as Point;
    expect((await setEstimate(item.key, foreignPoint.id)).status).toBe(422);
    expect((await setEstimate(item.key, "nope")).status).toBe(422);
    const cleared = await w.call(
      w.manager.user,
      `/api/work-items/${item.key}/estimate`,
      {
        method: "PUT",
        body: { estimatePointId: null },
      },
    );
    expect(cleared.status).toBe(200);
    expect(await pointIdOf(item.id)).toBeNull();
    expect(await auditActionsFor(item.id)).toContain("estimate.work_item_set");
  });

  it("renaming a point keeps every estimate on it (history is not rewritten)", async () => {
    const config = await configurePoints();
    const item = await w.items.makeItem("Item", {
      estimatePointId: pointOf(config, "3").id,
    });
    const points = config.points.map((p) => ({
      key: p.key,
      value: p.value === "3" ? "4" : p.value,
    }));
    const preview = await w.json<Patched>(
      await patch({ points, dryRun: true }),
    );
    expect(preview).toMatchObject({ applied: false });
    expect(preview.preview).toMatchObject({ mappedItems: 1, clearedItems: 0 });
    const applied = await w.json<Patched>(await patch({ points }));
    expect(applied.applied).toBe(true);
    expect(await pointIdOf(item.id)).toBe(pointOf(config, "3").id);
    const after = await getConfig();
    expect(
      after.points.find((p) => p.id === pointOf(config, "3").id)?.value,
    ).toBe("4");
    expect(
      after.points.find((p) => p.id === pointOf(config, "3").id)?.weight,
    ).toBe(4);
  });

  it("rolls a parent up from its children only when it has no estimate; the discrepancy is shown", async () => {
    const config = await configurePoints();
    const parent = await w.items.makeItem("Parent");
    await w.items.makeItem("Child A", {
      parentId: parent.id,
      estimatePointId: pointOf(config, "3").id,
    });
    const middle = await w.items.makeItem("Child B", { parentId: parent.id });
    await w.items.makeItem("Grandchild", {
      parentId: middle.id,
      estimatePointId: pointOf(config, "5").id,
    });
    await w.items.makeItem("Child C", { parentId: parent.id });
    const rollup = async (key: string) =>
      w.json<{
        rollup: {
          own: number | null;
          rollup: number | null;
          effective: number | null;
          discrepancy: boolean;
        };
      }>(await w.call(w.manager.user, `/api/work-items/${key}/estimate`));
    expect((await rollup(parent.key)).rollup).toEqual({
      own: null,
      rollup: 8,
      effective: 8,
      discrepancy: false,
    });
    await w.json(await setEstimate(parent.key, pointOf(config, "13").id));
    expect((await rollup(parent.key)).rollup).toEqual({
      own: 13,
      rollup: 8,
      effective: 13,
      discrepancy: true,
    });
  });

  it("reports unestimated work instead of counting it as zero (cycle summary)", async () => {
    const config = await configurePoints();
    const cycle = await w.json<{ id: string }>(
      await w.call(w.manager.user, `/api/projects/${w.project.slug}/cycles`, {
        method: "POST",
        body: {
          name: "Sprint",
          startDate: new Date(Date.now() - 2 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          endDate: new Date(Date.now() + 5 * 86_400_000)
            .toISOString()
            .slice(0, 10),
        },
      }),
      201,
    );
    const estimated = await w.items.makeItem("E", {
      estimatePointId: pointOf(config, "8").id,
    });
    const bare = await w.items.makeItem("U");
    await w.json(
      await w.call(w.manager.user, `/api/cycles/${cycle.id}/work-items`, {
        method: "POST",
        body: { workItemKeys: [estimated.key, bare.key] },
      }),
    );
    const detail = await w.json<{
      summary: {
        unit: string;
        total: { count: number; points: number };
        unestimated: { count: number; share: number };
      };
    }>(await w.call(w.manager.user, `/api/cycles/${cycle.id}`));
    expect(detail.summary).toMatchObject({
      unit: "points",
      total: { count: 2, points: 8 },
      unestimated: { count: 1, share: 0.5 },
    });
  });
});

describe("changing the system (ES-3)", () => {
  async function pointsWithEstimates() {
    const config = await configurePoints();
    const a = await w.items.makeItem("A", {
      estimatePointId: pointOf(config, "1").id,
    });
    const b = await w.items.makeItem("B", {
      estimatePointId: pointOf(config, "5").id,
    });
    const c = await w.items.makeItem("C", {
      estimatePointId: pointOf(config, "5").id,
    });
    return { config, a, b, c };
  }

  it("the dry-run preview matches what the applied change does, and clearing needs confirmation", async () => {
    const { a, b, c } = await pointsWithEstimates();
    const body = {
      system: "categories",
      points: [{ value: "1" }, { value: "S" }, { value: "M" }],
    };
    const preview = await w.json<Patched>(
      await patch({ ...body, dryRun: true }),
    );
    expect(preview.applied).toBe(false);
    expect(preview.preview).toMatchObject({
      fromSystem: "points",
      toSystem: "categories",
      mappedItems: 1,
      clearedItems: 2,
    });
    expect(
      preview.preview.mapping.find((m) => m.fromValue === "1")?.toValue,
    ).toBe("1");
    // the dry run changed nothing
    expect((await getConfig()).system).toBe("points");
    expect(await pointIdOf(b.id)).not.toBeNull();
    // clearing without confirmation is a 409 carrying the same preview
    const refused = await patch(body);
    expect(refused.status).toBe(409);
    const refusedBody = (await refused.json()) as {
      message: string;
      preview: Preview;
    };
    expect(refusedBody.message).toBe("estimate_change_requires_confirmation");
    expect(refusedBody.preview).toMatchObject({
      mappedItems: 1,
      clearedItems: 2,
    });
    expect((await getConfig()).system).toBe("points");
    // confirmed: exactly what the preview promised
    const applied = await w.json<Patched>(
      await patch({ ...body, confirmClear: true }),
    );
    expect(applied.applied).toBe(true);
    expect(applied.preview).toMatchObject({ mappedItems: 1, clearedItems: 2 });
    const mapped = await pointIdOf(a.id);
    const after = await getConfig();
    expect(after.system).toBe("categories");
    expect(after.points.find((p) => p.id === mapped)?.value).toBe("1");
    expect(await pointIdOf(b.id)).toBeNull();
    expect(await pointIdOf(c.id)).toBeNull();
    // the old estimate row and its points stay (history), only one is active
    const rows = await db
      .select()
      .from(estimateTable)
      .where(eq(estimateTable.projectId, w.project.id));
    expect(rows.filter((r) => r.active)).toHaveLength(1);
    expect(rows.length).toBe(2);
    const oldPoints = await db
      .select()
      .from(estimatePointTable)
      .where(
        and(
          eq(
            estimatePointTable.estimateId,
            rows.find((r) => !r.active)?.id as string,
          ),
        ),
      );
    expect(oldPoints.length).toBe(7);
  });

  it("removing a point in the same system clears only its items and needs confirmation", async () => {
    const { config, a, b } = await pointsWithEstimates();
    const points = config.points
      .filter((p) => p.value !== "5")
      .map((p) => ({ key: p.key, value: p.value }));
    expect((await patch({ points })).status).toBe(409);
    const applied = await w.json<Patched>(
      await patch({ points, confirmClear: true }),
    );
    expect(applied.preview).toMatchObject({ mappedItems: 1, clearedItems: 2 });
    expect(await pointIdOf(a.id)).toBe(pointOf(config, "1").id);
    expect(await pointIdOf(b.id)).toBeNull();
    expect((await getConfig()).points).toHaveLength(6);
  });

  it("notes the discontinuity on an active cycle's burndown and warns before the change", async () => {
    const { a } = await pointsWithEstimates();
    const cycle = await w.json<{ id: string }>(
      await w.call(w.manager.user, `/api/projects/${w.project.slug}/cycles`, {
        method: "POST",
        body: {
          name: "Sprint",
          startDate: new Date(Date.now() - 2 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          endDate: new Date(Date.now() + 5 * 86_400_000)
            .toISOString()
            .slice(0, 10),
        },
      }),
      201,
    );
    await w.json(
      await w.call(w.manager.user, `/api/cycles/${cycle.id}/work-items`, {
        method: "POST",
        body: { workItemKeys: [a.key] },
      }),
    );
    const preview = await w.json<Patched>(
      await patch({ system: "time", dryRun: true }),
    );
    expect(preview.preview.activeCycles.map((c) => c.id)).toEqual([cycle.id]);
    await w.json(await patch({ system: "time", confirmClear: true }));
    const burndown = await w.json<{
      unit: string;
      discontinuities: Array<{
        kind: string;
        fromSystem: string;
        toSystem: string;
      }>;
    }>(await w.call(w.manager.user, `/api/cycles/${cycle.id}/burndown`));
    expect(burndown.unit).toBe("time");
    expect(burndown.discontinuities).toEqual([
      expect.objectContaining({
        kind: "system",
        fromSystem: "points",
        toSystem: "time",
      }),
    ]);
    const detail = await w.json<{ discontinuities: unknown[] }>(
      await w.call(w.manager.user, `/api/cycles/${cycle.id}`),
    );
    expect(detail.discontinuities).toHaveLength(1);
  });
});

describe("flag, permission and tenant behaviour", () => {
  it("is hidden while feature.estimates is off and keeps the data", async () => {
    const config = await configurePoints();
    const item = await w.items.makeItem("Item", {
      estimatePointId: pointOf(config, "2").id,
    });
    await setAgileFlags(w.project.id, { estimates: false });
    for (const [path, method, body] of [
      [estimatesPath(), "GET", undefined],
      [estimatesPath(), "PATCH", { system: "time" }],
      [`/api/work-items/${item.key}/estimate`, "GET", undefined],
      [
        `/api/work-items/${item.key}/estimate`,
        "PUT",
        { estimatePointId: null },
      ],
    ] as const) {
      const response = await w.call(w.manager.user, path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.text()).toContain("feature_disabled");
    }
    expect(await pointIdOf(item.id)).toBe(pointOf(config, "2").id);
    await setAgileFlags(w.project.id, { estimates: true });
    expect((await getConfig()).system).toBe("points");
  });

  it("lets a reader see but not configure or set; an outsider gets 404", async () => {
    const config = await configurePoints();
    const item = await w.items.makeItem("Item");
    expect((await w.call(w.reader.user, estimatesPath())).status).toBe(200);
    expect(
      (await w.json<Config>(await w.call(w.reader.user, estimatesPath())))
        .canManage,
    ).toBe(false);
    expect((await patch({ system: "time" }, w.reader.user)).status).toBe(403);
    expect(
      (await setEstimate(item.key, pointOf(config, "1").id, w.reader.user))
        .status,
    ).toBe(403);
    expect((await w.call(w.outsider.user, estimatesPath())).status).toBe(404);
    expect(
      (await setEstimate(item.key, pointOf(config, "1").id, w.outsider.user))
        .status,
    ).toBe(404);
  });

  it("never leaks across tenants", async () => {
    const config = await configurePoints();
    const item = await w.items.makeItem("Item");
    expect((await w.call(w.foreign.user, estimatesPath())).status).toBe(404);
    expect((await patch({ system: "time" }, w.foreign.user)).status).toBe(404);
    expect(
      (await setEstimate(item.key, pointOf(config, "1").id, w.foreign.user))
        .status,
    ).toBe(404);
  });

  it("stores and validates the cycle completion default", async () => {
    const settings = await w.json<{
      incompletePolicy: string;
      version: number;
    }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.slug}/agile-settings`,
      ),
    );
    expect(settings.incompletePolicy).toBe("backlog");
    const bad = await w.call(
      w.manager.user,
      `/api/projects/${w.project.slug}/agile-settings`,
      {
        method: "PATCH",
        body: { incompletePolicy: "vanish" },
      },
    );
    expect(bad.status).toBe(400);
    const set = await w.json<{ incompletePolicy: string; version: number }>(
      await w.call(
        w.manager.user,
        `/api/projects/${w.project.slug}/agile-settings`,
        {
          method: "PATCH",
          body: { incompletePolicy: "next_cycle" },
        },
      ),
    );
    expect(set.incompletePolicy).toBe("next_cycle");
    expect(
      (
        await w.call(
          w.reader.user,
          `/api/projects/${w.project.slug}/agile-settings`,
          {
            method: "PATCH",
            body: { incompletePolicy: "leave" },
          },
        )
      ).status,
    ).toBe(403);
  });
});
