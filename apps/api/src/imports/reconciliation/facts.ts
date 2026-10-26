/**
 * Reconciliation facts: read-only queries scoped to the run's immutable
 * (workspace, plugin, sourceRef). Every query filters by the run's workspace, so a second tenant
 * importing the same source reference is never counted. Callers pass a transaction.
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Transaction } from "../../database/executor";
import type { importRunTable } from "../../database/schema-imports";
import { loadMapping } from "../engine/store";

/** Any run with a destination project: engine runs and the retained MCP chunk runs. */
export type EngineRun = typeof importRunTable.$inferSelect & {
  projectId: string;
};

import type {
  HierarchySample,
  LinkSample,
  LossGroup,
  LossSample,
  OutcomeCounts,
  ReconciliationFacts,
  RelationSample,
  SpotItem,
  StaleSample,
} from "./evaluate";

export const SPOT_CHECK_SIZE = 20;
const SAMPLE = 20;

type Scope = { workspaceId: string; pluginId: string; sourceRef: string };
const scopeOf = (run: EngineRun): Scope => ({
  workspaceId: run.workspaceId,
  pluginId: run.pluginId,
  sourceRef: run.sourceRef,
});

const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value ? String(value) : "";

function outcome(value: unknown): OutcomeCounts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const n = (key: string) => num(v[key]);
  return {
    created: n("created"),
    updated: n("updated"),
    skipped: n("skipped"),
    rejected: n("rejected"),
    processed: n("processed"),
  };
}

async function rowsOf<T>(
  tx: Transaction,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return (await tx.execute(query)).rows as T[];
}

/** Source-side totals from the approved whole-run dry run, the discovery and the saved mapping. */
async function sourceFacts(tx: Transaction, run: EngineRun) {
  const report = run.engineDryRunReport as {
    counts?: unknown;
    byType?: Record<string, unknown>;
  } | null;
  const counts = outcome(report?.counts);
  const byType: Record<string, OutcomeCounts> = {};
  for (const [type, value] of Object.entries(report?.byType ?? {})) {
    const parsed = outcome(value);
    if (parsed) byType[type] = parsed;
  }
  const discovery = run.engineDiscovery as { totalRecords?: unknown } | null;
  const discoveryTotal =
    typeof discovery?.totalRecords === "number" ? discovery.totalRecords : null;
  const mapping = await loadMapping(tx, run, "share");
  const confirmed = mapping.entries.filter(
    (e) => e.status === "confirmed" && e.target,
  );
  const mapped = (
    domain: string,
    pick: (
      target: NonNullable<(typeof confirmed)[number]["target"]>,
    ) => string | null,
  ): Record<string, number> | null => {
    const entries = confirmed.filter((e) => e.domain === domain);
    if (!entries.length) return null;
    const out: Record<string, number> = {};
    for (const e of entries) {
      const key = e.target ? pick(e.target) : null;
      if (key) out[key] = (out[key] ?? 0) + e.affected;
    }
    return out;
  };
  const typeIds = mapped("type", (t) => (t.kind === "target" ? t.id : null));
  return {
    available: counts !== null,
    counts,
    byType,
    discoveryTotal,
    mappedStateGroups: mapped("state", (t) =>
      t.kind === "group" ? t.group : null,
    ),
    mappedTypes: typeIds,
    mappedProjects: mapped("project", (t) =>
      t.kind === "target" ? t.id : null,
    ),
  };
}

const LINKED_FROM = (s: Scope) => sql`
  FROM import_record_link l
  JOIN work_item w ON w.id = l.target_id AND w.workspace_id = l.workspace_id
  LEFT JOIN state st ON st.id = w.state_id
  LEFT JOIN state_template tpl ON tpl.id = st.state_template_id
  WHERE l.workspace_id = ${s.workspaceId} AND l.plugin_id = ${s.pluginId}
    AND l.source_ref = ${s.sourceRef} AND l.target_type = 'work_item'
    AND l.stale_at IS NULL AND w.deleted_at IS NULL`;

const bump = (map: Record<string, number>, key: string | null, n: number) => {
  const k = key ?? "unknown";
  map[k] = (map[k] ?? 0) + n;
};

async function targetFacts(tx: Transaction, run: EngineRun) {
  const s = scopeOf(run);
  const grouped = await rowsOf<{
    source_type: string;
    project_id: string;
    type_id: string;
    state_group: string | null;
    n: string;
  }>(
    tx,
    sql`SELECT l.source_type, w.project_id, w.type_id, tpl."group" AS state_group, count(*) AS n
      ${LINKED_FROM(s)} GROUP BY 1, 2, 3, 4`,
  );
  const target = {
    linkedTotal: 0,
    linkedBySourceType: {} as Record<string, number>,
    linkedByType: {} as Record<string, number>,
    linkedByStateGroup: {} as Record<string, number>,
    linkedByProject: {} as Record<string, number>,
    touchedByRun: 0,
  };
  for (const row of grouped) {
    const n = num(row.n);
    target.linkedTotal += n;
    bump(target.linkedBySourceType, row.source_type, n);
    bump(target.linkedByType, row.type_id, n);
    bump(target.linkedByStateGroup, row.state_group, n);
    bump(target.linkedByProject, row.project_id, n);
  }
  const [touched] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n FROM import_record_link
      WHERE workspace_id = ${s.workspaceId} AND import_run_id = ${run.id}
        AND target_type = 'work_item'`,
  );
  target.touchedByRun = num(touched?.n);
  return target;
}

async function labelFacts(tx: Transaction, run: EngineRun) {
  const projects = await rowsOf<{ id: string; name: string }>(
    tx,
    sql`SELECT id, name FROM project WHERE workspace_id = ${run.workspaceId} LIMIT 1000`,
  );
  const types = await rowsOf<{ id: string; key: string }>(
    tx,
    sql`SELECT id, key FROM work_item_type WHERE workspace_id = ${run.workspaceId} LIMIT 1000`,
  );
  return {
    projects: Object.fromEntries(projects.map((p) => [p.id, p.name])),
    types: Object.fromEntries(types.map((t) => [t.id, t.key])),
  };
}

async function staleFacts(tx: Transaction, run: EngineRun) {
  const s = scopeOf(run);
  const [links] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n FROM import_record_link
      WHERE workspace_id = ${s.workspaceId} AND plugin_id = ${s.pluginId}
        AND source_ref = ${s.sourceRef} AND stale_at IS NOT NULL`,
  );
  const [provenance] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n FROM external_link
      WHERE workspace_id = ${s.workspaceId} AND system = ${s.sourceRef}
        AND origin = 'imported' AND stale_at IS NOT NULL`,
  );
  const sample = await rowsOf<{
    source_type: string;
    source_id: string;
    source_url: string | null;
    target_id: string;
    stale_at: Date;
  }>(
    tx,
    sql`SELECT source_type, source_id, source_url, target_id, stale_at FROM import_record_link
      WHERE workspace_id = ${s.workspaceId} AND plugin_id = ${s.pluginId}
        AND source_ref = ${s.sourceRef} AND stale_at IS NOT NULL
      ORDER BY stale_at, id LIMIT ${SAMPLE}`,
  );
  return {
    links: num(links?.n),
    provenance: num(provenance?.n),
    sample: sample.map(
      (r): StaleSample => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        sourceUrl: r.source_url,
        targetId: r.target_id,
        staleAt: iso(r.stale_at),
      }),
    ),
  };
}

async function lossFacts(tx: Transaction, run: EngineRun) {
  const grouped = await rowsOf<{
    code: string;
    detail_code: string;
    source_type: string;
    n: string;
  }>(
    tx,
    sql`SELECT code, detail_code, source_type, count(*) AS n FROM import_loss
      WHERE workspace_id = ${run.workspaceId} AND import_run_id = ${run.id}
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  );
  const byCode = new Map<string, LossGroup>();
  const rejections = new Map<string, number>();
  for (const row of grouped) {
    const n = num(row.n);
    const group = byCode.get(row.code) ?? {
      code: row.code,
      count: 0,
      bySourceType: [],
      byDetail: [],
    };
    group.count += n;
    const type = group.bySourceType.find(
      (t) => t.sourceType === row.source_type,
    );
    if (type) type.count += n;
    else group.bySourceType.push({ sourceType: row.source_type, count: n });
    const detail = group.byDetail.find((d) => d.detailCode === row.detail_code);
    if (detail) detail.count += n;
    else group.byDetail.push({ detailCode: row.detail_code, count: n });
    byCode.set(row.code, group);
    if (row.code === "record_rejected")
      rejections.set(
        row.detail_code,
        (rejections.get(row.detail_code) ?? 0) + n,
      );
  }
  const samples = await rowsOf<{
    code: string;
    detail_code: string;
    source_type: string;
    source_id: string;
    source_url: string | null;
  }>(
    tx,
    sql`SELECT code, detail_code, source_type, source_id, source_url FROM import_loss
      WHERE workspace_id = ${run.workspaceId} AND import_run_id = ${run.id}
      ORDER BY code, source_type, source_id LIMIT ${SAMPLE}`,
  );
  return {
    losses: [...byCode.values()],
    lossSamples: samples.map(
      (r): LossSample => ({
        code: r.code,
        detailCode: r.detail_code,
        sourceType: r.source_type,
        sourceId: r.source_id,
        sourceUrl: r.source_url,
      }),
    ),
    rejections: [...rejections.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

async function danglingFacts(tx: Transaction, run: EngineRun) {
  const s = scopeOf(run);
  const linkScope = sql`l.workspace_id = ${s.workspaceId} AND l.plugin_id = ${s.pluginId}
    AND l.source_ref = ${s.sourceRef} AND l.stale_at IS NULL`;
  const missing = sql`l.target_type = 'work_item' AND NOT EXISTS (
    SELECT 1 FROM work_item w WHERE w.id = l.target_id
      AND w.workspace_id = l.workspace_id AND w.deleted_at IS NULL)`;
  const [linkCount] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n FROM import_record_link l WHERE ${linkScope} AND ${missing}`,
  );
  const linkSample = await rowsOf<{
    source_type: string;
    source_id: string;
    source_url: string | null;
    target_id: string;
  }>(
    tx,
    sql`SELECT l.source_type, l.source_id, l.source_url, l.target_id
      FROM import_record_link l WHERE ${linkScope} AND ${missing}
      ORDER BY l.source_type, l.source_id LIMIT ${SAMPLE}`,
  );
  const [relationLinks] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n FROM import_record_link l
      WHERE ${linkScope} AND l.target_type = 'relation'
        AND NOT EXISTS (SELECT 1 FROM work_item_relation r WHERE r.id = l.target_id)`,
  );
  const unresolvedScope = sql`e.workspace_id = ${s.workspaceId} AND e.system = ${s.sourceRef}
    AND e.origin = 'imported' AND e.entity_type = 'work_item'
    AND e.deferred_links IS NOT NULL`;
  const [unresolvedCount] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n FROM external_link e WHERE ${unresolvedScope}`,
  );
  const unresolvedSample = await rowsOf<{
    source_type: string | null;
    source_id: string | null;
    external_id: string;
    url: string | null;
  }>(
    tx,
    sql`SELECT e.deferred_links->'self'->>'sourceType' AS source_type,
        e.deferred_links->'self'->>'sourceId' AS source_id, e.external_id, e.url
      FROM external_link e WHERE ${unresolvedScope}
      ORDER BY e.external_id LIMIT ${SAMPLE}`,
  );
  const parentFrom = sql`FROM import_record_link l
    JOIN work_item w ON w.id = l.target_id AND w.workspace_id = l.workspace_id
    JOIN work_item p ON p.id = w.parent_id
    WHERE ${linkScope} AND l.target_type = 'work_item' AND w.deleted_at IS NULL
      AND (p.deleted_at IS NOT NULL OR p.project_id <> w.project_id)`;
  const [parentCount] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n ${parentFrom}`,
  );
  const parentSample = await rowsOf<{
    source_type: string;
    source_id: string;
    source_url: string | null;
    key: string;
    parent_deleted: boolean;
  }>(
    tx,
    sql`SELECT l.source_type, l.source_id, l.source_url, w.key,
        (p.deleted_at IS NOT NULL) AS parent_deleted
      ${parentFrom} ORDER BY w.key LIMIT ${SAMPLE}`,
  );
  const relationFrom = sql`FROM work_item_relation r
    JOIN work_item a ON a.id = r.source_id
    JOIN work_item b ON b.id = r.target_id
    WHERE (a.deleted_at IS NOT NULL OR b.deleted_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM import_record_link l
        WHERE ${linkScope} AND l.target_type = 'work_item'
          AND l.target_id IN (r.source_id, r.target_id))`;
  const [relationCount] = await rowsOf<{ n: string }>(
    tx,
    sql`SELECT count(*) AS n ${relationFrom}`,
  );
  const relationSample = await rowsOf<{
    source_key: string;
    target_key: string;
    type: string;
  }>(
    tx,
    sql`SELECT a.key AS source_key, b.key AS target_key, r.type
      ${relationFrom} ORDER BY a.key, b.key LIMIT ${SAMPLE}`,
  );
  return {
    links: {
      count: num(linkCount?.n),
      sample: linkSample.map(
        (r): LinkSample => ({
          sourceType: r.source_type,
          sourceId: r.source_id,
          sourceUrl: r.source_url,
          targetId: r.target_id,
        }),
      ),
    },
    relationLinks: { count: num(relationLinks?.n) },
    unresolved: {
      count: num(unresolvedCount?.n),
      sample: unresolvedSample.map(
        (r): LinkSample => ({
          sourceType: r.source_type ?? "work_item",
          sourceId: r.source_id ?? r.external_id,
          sourceUrl: r.url,
          targetId: null,
        }),
      ),
    },
    parents: {
      count: num(parentCount?.n),
      sample: parentSample.map(
        (r): HierarchySample => ({
          sourceType: r.source_type,
          sourceId: r.source_id,
          sourceUrl: r.source_url,
          targetKey: r.key,
          problem: r.parent_deleted ? "parent_deleted" : "parent_other_project",
        }),
      ),
    },
    relations: {
      count: num(relationCount?.n),
      sample: relationSample.map(
        (r): RelationSample => ({
          sourceKey: r.source_key,
          targetKey: r.target_key,
          type: r.type,
          problem: "other_end_deleted",
        }),
      ),
    },
  };
}

async function spotCheck(tx: Transaction, run: EngineRun, seed: string) {
  const s = scopeOf(run);
  const rows = await rowsOf<{
    source_type: string;
    source_id: string;
    source_url: string | null;
    id: string;
    key: string;
    title: string;
    state_group: string | null;
    state_name: string | null;
    assigned: boolean;
    start_date: Date | null;
    due_date: Date | null;
  }>(
    tx,
    sql`SELECT l.source_type, l.source_id, l.source_url, w.id, w.key, w.title,
        tpl."group" AS state_group, tpl.name AS state_name,
        (w.assignee_id IS NOT NULL) AS assigned, w.start_date, w.due_date
      ${LINKED_FROM(s)}
      ORDER BY md5(l.id || ${seed}), l.id LIMIT ${SPOT_CHECK_SIZE}`,
  );
  return rows.map(
    (r): SpotItem => ({
      sourceType: r.source_type,
      sourceId: r.source_id,
      sourceUrl: r.source_url,
      targetId: r.id,
      targetKey: r.key,
      title: r.title,
      stateGroup: r.state_group,
      stateName: r.state_name,
      assigned: r.assigned,
      startDate: r.start_date ? iso(r.start_date) : null,
      dueDate: r.due_date ? iso(r.due_date) : null,
    }),
  );
}

/** Reproducible spot-check: the seed is persisted with the snapshot. */
export const newSpotCheckSeed = () => randomBytes(8).toString("hex");

export async function gatherFacts(
  tx: Transaction,
  run: EngineRun,
  seed: string,
): Promise<ReconciliationFacts> {
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(run.stats))
    if (typeof v === "number") stats[k] = v;
  const losses = await lossFacts(tx, run);
  return {
    run: { id: run.id, state: run.state, projectId: run.projectId, stats },
    source: await sourceFacts(tx, run),
    target: await targetFacts(tx, run),
    labels: await labelFacts(tx, run),
    stale: await staleFacts(tx, run),
    ...losses,
    dangling: await danglingFacts(tx, run),
    spotCheck: { seed, items: await spotCheck(tx, run, seed) },
  };
}
