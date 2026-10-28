import { describe, expect, it } from "vitest";
import {
  evaluateReconciliation,
  type ReconciliationFacts,
} from "../../../../apps/api/src/imports/reconciliation/evaluate";

const counts = (c: Partial<Record<string, number>> = {}) => ({
  created: 0,
  updated: 0,
  skipped: 0,
  rejected: 0,
  processed: 0,
  ...c,
});

function clean(): ReconciliationFacts {
  return {
    run: {
      id: "run1",
      state: "completed",
      projectId: "p1",
      stats: {
        created: 10,
        updated: 0,
        skipped: 0,
        rejected: 0,
        processed: 10,
      },
    },
    source: {
      available: true,
      counts: counts({ created: 10, processed: 10 }),
      byType: { issue: counts({ created: 10, processed: 10 }) },
      discoveryTotal: 10,
      mappedStateGroups: { backlog: 6, started: 4 },
      mappedTypes: { t1: 10 },
      mappedProjects: null,
    },
    target: {
      linkedTotal: 10,
      linkedBySourceType: { issue: 10 },
      linkedByType: { t1: 10 },
      linkedByStateGroup: { backlog: 6, started: 4 },
      linkedByProject: { p1: 10 },
      touchedByRun: 10,
    },
    labels: { projects: { p1: "Help" }, types: { t1: "task" } },
    stale: { links: 0, provenance: 0, sample: [] },
    losses: [],
    lossSamples: [],
    rejections: [],
    dangling: {
      links: { count: 0, sample: [] },
      relationLinks: { count: 0 },
      unresolved: { count: 0, sample: [] },
      parents: { count: 0, sample: [] },
      relations: { count: 0, sample: [] },
    },
    spotCheck: { seed: "s", items: [] },
  };
}

describe("evaluateReconciliation", () => {
  it("passes a clean run and every count row matches", () => {
    const out = evaluateReconciliation(clean());
    expect(out.status).toBe("pass");
    expect(out.checks.filter((c) => !c.ok)).toEqual([]);
    expect(out.rows.length).toBeGreaterThan(5);
    for (const row of out.rows) expect(row.source).toBe(row.target);
    expect(out.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining([
        "total",
        "linked",
        "source_type:issue",
        "type:t1",
        "state_group:backlog",
        "project:p1",
      ]),
    );
  });

  it("shows a rejected row as attention and as a mismatch-free rejected row", () => {
    const f = clean();
    f.run.stats = {
      created: 9,
      updated: 0,
      skipped: 0,
      rejected: 1,
      processed: 10,
    };
    f.source.counts = counts({ created: 9, rejected: 1, processed: 10 });
    f.target.linkedTotal = 9;
    f.target.linkedBySourceType = { issue: 9 };
    const out = evaluateReconciliation(f);
    expect(out.status).toBe("attention");
    expect(out.checks.find((c) => c.code === "no_rejections")?.ok).toBe(false);
    expect(out.rows.find((r) => r.key === "rejected")).toMatchObject({
      source: 1,
      target: 1,
    });
    expect(out.checks.find((c) => c.code === "targets_linked")?.ok).toBe(true);
  });

  it("fails when a linked target is missing", () => {
    const f = clean();
    f.target.linkedTotal = 9;
    expect(evaluateReconciliation(f).status).toBe("fail");
  });

  it("fails on a dangling parent and a dangling link, attention on stale and losses", () => {
    const parent = clean();
    parent.dangling.parents = {
      count: 1,
      sample: [],
    };
    expect(evaluateReconciliation(parent).status).toBe("fail");
    const link = clean();
    link.dangling.links.count = 2;
    expect(evaluateReconciliation(link).status).toBe("fail");
    const soft = clean();
    soft.stale.links = 1;
    soft.losses = [
      { code: "rich_text_lossy", count: 3, bySourceType: [], byDetail: [] },
    ];
    const out = evaluateReconciliation(soft);
    expect(out.status).toBe("attention");
    expect(
      out.checks
        .filter((c) => !c.ok)
        .map((c) => c.code)
        .sort(),
    ).toEqual(["no_losses", "no_stale_links"]);
  });

  it("fails an inconsistent outcome sum", () => {
    const f = clean();
    f.run.stats = { created: 5, processed: 10 };
    const out = evaluateReconciliation(f);
    expect(out.checks.find((c) => c.code === "stats_consistent")?.ok).toBe(
      false,
    );
    expect(out.status).toBe("fail");
  });

  it("without a source enumeration omits count rows and never passes", () => {
    const f = clean();
    f.source = {
      available: false,
      counts: null,
      byType: {},
      discoveryTotal: null,
      mappedStateGroups: null,
      mappedTypes: null,
      mappedProjects: null,
    };
    const out = evaluateReconciliation(f);
    expect(out.rows).toEqual([]);
    expect(out.status).toBe("attention");
  });

  it("flags a run that has not completed", () => {
    const f = clean();
    f.run.state = "running";
    const out = evaluateReconciliation(f);
    expect(out.status).toBe("attention");
  });
});
