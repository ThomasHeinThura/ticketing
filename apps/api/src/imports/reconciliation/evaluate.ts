/**
 * Reconciliation evaluation (pure, no database). Turns gathered facts into the comparison rows the
 * wizard shows, the invariant checks and the overall status.
 *
 * Pass invariants (a `fail` check blocks `pass`; a `warn` check yields `attention`):
 *   stats_consistent      processed == created + updated + skipped + rejected          (fail)
 *   source_total_matches  source enumeration total == run processed                    (fail)
 *   targets_linked        live linked work items >= importable (processed - rejected)  (fail)
 *   targets_not_extra     live linked work items <= importable                         (warn)
 *   no_dangling_links     no ledger link whose work item is gone or soft-deleted       (fail)
 *   no_unresolved_links   no provenance row still holding deferred parent/relation     (fail)
 *   no_dangling_parents   no imported child whose parent is deleted or in another project (fail)
 *   no_dangling_relations no relation touching an imported item whose other end is deleted (fail)
 *   run_completed         the run finished                                             (warn)
 *   no_rejections / no_losses / no_stale_links   reported, never hidden                (warn)
 * Without a source enumeration (a run that never had a whole-run dry run) the count rows are
 * omitted and the status can never be `pass`.
 */
import type { ImportReconciliationStatus } from "../../database/schema-import-reconciliation";

export const STATE_GROUP_KEYS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

export type OutcomeCounts = {
  created: number;
  updated: number;
  skipped: number;
  rejected: number;
  processed: number;
};

export type ReconciliationFacts = {
  run: {
    id: string;
    state: string;
    projectId: string;
    stats: Record<string, number>;
  };
  source: {
    available: boolean;
    /** Whole-run dry-run counts (the enumeration the operator approved). */
    counts: OutcomeCounts | null;
    byType: Record<string, OutcomeCounts>;
    /** Discovery total, when discovery ran. */
    discoveryTotal: number | null;
    /** Discovery facet counts mapped through the saved mapping. */
    mappedStateGroups: Record<string, number> | null;
    mappedTypes: Record<string, number> | null;
    mappedProjects: Record<string, number> | null;
  };
  target: {
    linkedTotal: number;
    linkedBySourceType: Record<string, number>;
    linkedByType: Record<string, number>;
    linkedByStateGroup: Record<string, number>;
    linkedByProject: Record<string, number>;
    touchedByRun: number;
  };
  labels: { projects: Record<string, string>; types: Record<string, string> };
  stale: { links: number; provenance: number; sample: StaleSample[] };
  losses: LossGroup[];
  lossSamples: LossSample[];
  rejections: { code: string; count: number }[];
  dangling: {
    links: { count: number; sample: LinkSample[] };
    relationLinks: { count: number };
    unresolved: { count: number; sample: LinkSample[] };
    parents: { count: number; sample: HierarchySample[] };
    relations: { count: number; sample: RelationSample[] };
  };
  spotCheck: { seed: string; items: SpotItem[] };
};

export type StaleSample = {
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  targetId: string;
  staleAt: string;
};
export type LinkSample = {
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  targetId: string | null;
};
export type HierarchySample = {
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  targetKey: string;
  problem: "parent_deleted" | "parent_other_project";
};
export type RelationSample = {
  sourceKey: string;
  targetKey: string;
  type: string;
  problem: "other_end_deleted";
};
export type LossGroup = {
  code: string;
  count: number;
  bySourceType: { sourceType: string; count: number }[];
  byDetail: { detailCode: string; count: number }[];
};
export type LossSample = {
  code: string;
  detailCode: string;
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
};
export type SpotItem = {
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  targetId: string;
  targetKey: string;
  title: string;
  stateGroup: string | null;
  stateName: string | null;
  assigned: boolean;
  startDate: string | null;
  dueDate: string | null;
};

export type ReconciliationRow = {
  key: string;
  label: string;
  source: number;
  target: number;
};
export type ReconciliationCheck = {
  code: string;
  ok: boolean;
  severity: "fail" | "warn";
  expected?: number;
  actual?: number;
};

const sum = (counts: OutcomeCounts) =>
  counts.created + counts.updated + counts.skipped + counts.rejected;

function statsCounts(stats: Record<string, number>): OutcomeCounts {
  const n = (key: string) => {
    const value = stats[key];
    return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
      ? value
      : 0;
  };
  return {
    created: n("created"),
    updated: n("updated"),
    skipped: n("skipped"),
    rejected: n("rejected"),
    processed: n("processed"),
  };
}

export function evaluateReconciliation(facts: ReconciliationFacts) {
  const actual = statsCounts(facts.run.stats);
  const { source, target } = facts;
  const importable = source.counts
    ? source.counts.processed - source.counts.rejected
    : null;
  const rows: ReconciliationRow[] = [];
  const checks: ReconciliationCheck[] = [];
  const check = (c: ReconciliationCheck) => checks.push(c);

  check({
    code: "stats_consistent",
    ok: actual.processed === sum(actual),
    severity: "fail",
    expected: actual.processed,
    actual: sum(actual),
  });
  check({
    code: "run_completed",
    ok: facts.run.state === "completed",
    severity: "warn",
  });

  if (source.available && source.counts && importable !== null) {
    const enumerated = source.discoveryTotal ?? source.counts.processed;
    rows.push({
      key: "total",
      label: "Records",
      source: enumerated,
      target: actual.processed,
    });
    rows.push({
      key: "outcomes",
      label: "Created, updated, skipped, rejected",
      source: actual.processed,
      target: sum(actual),
    });
    rows.push({
      key: "rejected",
      label: "Rejected",
      source: source.counts.rejected,
      target: actual.rejected,
    });
    rows.push({
      key: "linked",
      label: "Work items linked to source",
      source: importable,
      target: target.linkedTotal,
    });
    check({
      code: "source_total_matches",
      ok: enumerated === actual.processed,
      severity: "fail",
      expected: enumerated,
      actual: actual.processed,
    });
    check({
      code: "targets_linked",
      ok: target.linkedTotal >= importable,
      severity: "fail",
      expected: importable,
      actual: target.linkedTotal,
    });
    check({
      code: "targets_not_extra",
      ok: target.linkedTotal <= importable,
      severity: "warn",
      expected: importable,
      actual: target.linkedTotal,
    });
    for (const type of Object.keys(source.byType).sort()) {
      const counts = source.byType[type] as OutcomeCounts;
      rows.push({
        key: `source_type:${type}`,
        label: `Source type ${type}`,
        source: counts.processed - counts.rejected,
        target: target.linkedBySourceType[type] ?? 0,
      });
    }
    const mappedRows = (
      prefix: string,
      mapped: Record<string, number> | null,
      actualBy: Record<string, number>,
      label: (key: string) => string,
    ) => {
      if (!mapped) return;
      for (const key of [
        ...new Set([...Object.keys(mapped), ...Object.keys(actualBy)]),
      ].sort())
        rows.push({
          key: `${prefix}:${key}`,
          label: label(key),
          source: mapped[key] ?? 0,
          target: actualBy[key] ?? 0,
        });
    };
    mappedRows(
      "type",
      source.mappedTypes,
      target.linkedByType,
      (key) => `Type ${facts.labels.types[key] ?? key}`,
    );
    mappedRows(
      "state_group",
      source.mappedStateGroups,
      target.linkedByStateGroup,
      (key) => `State group ${key}`,
    );
    // No project facet means every record targets the run's project.
    mappedRows(
      "project",
      source.mappedProjects ?? { [facts.run.projectId]: importable },
      target.linkedByProject,
      (key) => `Project ${facts.labels.projects[key] ?? key}`,
    );
  }

  const zero = (code: string, count: number, severity: "fail" | "warn") =>
    check({ code, ok: count === 0, severity, expected: 0, actual: count });
  zero("no_dangling_links", facts.dangling.links.count, "fail");
  zero(
    "no_dangling_relation_links",
    facts.dangling.relationLinks.count,
    "fail",
  );
  zero("no_unresolved_links", facts.dangling.unresolved.count, "fail");
  zero("no_dangling_parents", facts.dangling.parents.count, "fail");
  zero("no_dangling_relations", facts.dangling.relations.count, "fail");
  zero("no_rejections", actual.rejected, "warn");
  zero(
    "no_losses",
    facts.losses.reduce((n, g) => n + g.count, 0),
    "warn",
  );
  zero("no_stale_links", facts.stale.links + facts.stale.provenance, "warn");

  const failed = checks.some((c) => !c.ok && c.severity === "fail");
  const warned = checks.some((c) => !c.ok && c.severity === "warn");
  const status: ImportReconciliationStatus = failed
    ? "fail"
    : warned || !source.available
      ? "attention"
      : "pass";
  return { rows, checks, status };
}
