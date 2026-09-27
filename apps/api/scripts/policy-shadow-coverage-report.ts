/**
 * Issue #8 / #324's outstanding acceptance item: "Coverage report. Measure, per router
 * group, the share of requests evaluated before and after."
 *
 * REPORT-ONLY, READ-ONLY -- same shape as `audit-reserved-workspace-role-names.ts`: a pure,
 * unit-tested aggregation function plus a `main()` that queries the database and prints.
 * Never wired into the request path, `runStartupTasks`, or any HTTP route --
 * `runbook.md`'s "Policy shadow summary" section already records this as "a documented SQL
 * query against these two tables, not a new HTTP endpoint (a route needs its own policy and
 * review, out of this slice's scope)". This script exists so that query does not have to be
 * typed by hand every time a cut-over PR needs "about 7 clean days" evidence (2026-09-23
 * decision log), and so the aggregation has a regression test instead of living only as
 * prose in `runbook.md`.
 *
 * **"Evaluated" means the shadow evaluator reached a real verdict to compare against the
 * legacy decision** -- `agree`, `legacy_allow_policy_deny` or `legacy_deny_policy_allow`.
 * `unevaluated` (no scope evidence, no identity, an unmapped self/portal route, a saturation
 * drop, ...) and `evaluator_error` (the comparison itself threw) both count as NOT
 * evaluated -- `shadow-middleware.ts`'s own `writeErrorRecord` never sets `policyAllowed`,
 * exactly like an `unevaluated` row never does.
 *
 * **This script reports coverage. It does not decide "clean".** `runbook.md`'s clean rule
 * additionally requires a human to explain every non-`agree` reason code in the cut-over PR,
 * and `shadow_saturated` is "never explainable" (Opus delta of #323, D1) -- both are
 * judgment calls this script cannot make. `disagreementRequests` and `hasSaturationDrops`
 * are surfaced so a reviewer does not have to re-derive them from the tables by hand, not as
 * a substitute for that read.
 *
 * Run manually against a deployment's own database:
 * `pnpm --filter @taskdesk/api exec tsx scripts/policy-shadow-coverage-report.ts [days]`
 * (defaults to 7, matching `runbook.md`'s window). Reads only -- exits 0 always, same as
 * the reserved-role-name audit script: a report, not a gate.
 */
import { gte } from "drizzle-orm";
import db from "../src/database";
import {
  policyShadowTallyTable,
  type ShadowOutcome,
} from "../src/permissions/shadow-schema";
import { utcDateString } from "../src/permissions/shadow-store";

export type ShadowTallyBucket = {
  readonly routerGroup: string;
  readonly outcome: ShadowOutcome;
  readonly reasonCode: string | null;
  readonly count: number;
};

export type RouterCoverage = {
  readonly routerGroup: string;
  readonly totalRequests: number;
  readonly evaluatedRequests: number;
  /** 0-100, rounded to 2 decimals. 0 when `totalRequests` is 0. */
  readonly evaluatedPercent: number;
  readonly unevaluatedRequests: number;
  readonly evaluatorErrorRequests: number;
  /** `legacy_allow_policy_deny` + `legacy_deny_policy_allow` -- a subset of `evaluatedRequests`. */
  readonly disagreementRequests: number;
  /** Any `unevaluated` row in the window carried `reason_code = 'shadow_saturated'`. */
  readonly hasSaturationDrops: boolean;
};

function roundPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

type MutableTotals = {
  total: number;
  evaluated: number;
  unevaluated: number;
  evaluatorError: number;
  disagreement: number;
  saturated: boolean;
};

function emptyTotals(): MutableTotals {
  return {
    total: 0,
    evaluated: 0,
    unevaluated: 0,
    evaluatorError: 0,
    disagreement: 0,
    saturated: false,
  };
}

/**
 * The pure half -- no I/O, exhaustively unit-testable without a database. Sums every bucket
 * row onto its `routerGroup`, regardless of how many `(day, route_key, reason_code)` rows
 * contributed to it: `policy_shadow_tally`'s own grain is finer than a router group, so the
 * caller is expected to have already selected every row in the window and left the summing
 * to this function.
 */
export function perRouterCoverage(
  rows: readonly ShadowTallyBucket[],
): RouterCoverage[] {
  const byGroup = new Map<string, MutableTotals>();

  for (const row of rows) {
    const bucket = byGroup.get(row.routerGroup) ?? emptyTotals();
    bucket.total += row.count;

    switch (row.outcome) {
      case "agree":
        bucket.evaluated += row.count;
        break;
      case "legacy_allow_policy_deny":
      case "legacy_deny_policy_allow":
        bucket.evaluated += row.count;
        bucket.disagreement += row.count;
        break;
      case "evaluator_error":
        bucket.evaluatorError += row.count;
        break;
      case "unevaluated":
        bucket.unevaluated += row.count;
        if (row.reasonCode === "shadow_saturated") {
          bucket.saturated = true;
        }
        break;
      default: {
        // Exhaustiveness guard: `SHADOW_OUTCOMES` has exactly five members today. A sixth
        // added there without a case here would otherwise vanish from every total silently.
        const unknownOutcome: never = row.outcome;
        throw new Error(
          `policy-shadow-coverage-report: unknown shadow outcome ${String(unknownOutcome)}`,
        );
      }
    }

    byGroup.set(row.routerGroup, bucket);
  }

  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([routerGroup, bucket]) => ({
      routerGroup,
      totalRequests: bucket.total,
      evaluatedRequests: bucket.evaluated,
      evaluatedPercent: roundPercent(bucket.evaluated, bucket.total),
      unevaluatedRequests: bucket.unevaluated,
      evaluatorErrorRequests: bucket.evaluatorError,
      disagreementRequests: bucket.disagreement,
      hasSaturationDrops: bucket.saturated,
    }));
}

const DEFAULT_LOOKBACK_DAYS = 7;

async function main() {
  const daysArg = Number(process.argv[2]);
  const lookbackDays =
    Number.isFinite(daysArg) && daysArg > 0 ? daysArg : DEFAULT_LOOKBACK_DAYS;
  const cutoff = utcDateString(
    new Date(Date.now() - lookbackDays * 86_400_000),
  );

  const rows = await db
    .select({
      routerGroup: policyShadowTallyTable.routerGroup,
      outcome: policyShadowTallyTable.outcome,
      reasonCode: policyShadowTallyTable.reasonCode,
      count: policyShadowTallyTable.count,
    })
    .from(policyShadowTallyTable)
    .where(gte(policyShadowTallyTable.day, cutoff));

  const coverage = perRouterCoverage(rows);

  if (coverage.length === 0) {
    console.log(
      `policy-shadow-coverage-report: no policy_shadow_tally rows in the last ${lookbackDays} day(s) -- shadow mode is off, or no router has been exercised yet.`,
    );
    return;
  }

  console.log(
    `policy-shadow-coverage-report: ${coverage.length} router group(s) with shadow-mode evidence in the last ${lookbackDays} day(s).`,
  );
  console.table(
    coverage.map((c) => ({
      router_group: c.routerGroup,
      total: c.totalRequests,
      evaluated: c.evaluatedRequests,
      "evaluated_%": c.evaluatedPercent,
      unevaluated: c.unevaluatedRequests,
      evaluator_error: c.evaluatorErrorRequests,
      disagreements: c.disagreementRequests,
      saturated: c.hasSaturationDrops,
    })),
  );

  const notClean = coverage.filter(
    (c) =>
      c.unevaluatedRequests > 0 ||
      c.evaluatorErrorRequests > 0 ||
      c.disagreementRequests > 0,
  );
  if (notClean.length > 0) {
    console.log(
      `\n${notClean.length} router group(s) have unevaluated, error or disagreement rows and are not yet clean (runbook.md "Policy shadow summary"). Every non-agree reason code still needs a human explanation in the cut-over PR; shadow_saturated is never explainable.`,
    );
  }
}

// Only run when invoked directly (`tsx scripts/policy-shadow-coverage-report.ts`), never
// when this module is imported for its exported pure function (its own unit test, e.g.).
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
