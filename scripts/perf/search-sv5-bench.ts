/**
 * SV-5 / SV-10 search benchmark (P1R3-1): seeds the reference dataset (10,000 work items,
 * 40,000 comments) into a scratch `_test` database and times the canonical work-item search
 * exactly as the global search controller runs it (canonical query, then the SV-9 fuzzy
 * fallback when the page is empty), printing p50/p95/max per term.
 *
 * Run from the repository root with TASKDESK_DATABASE_URL pointing at a disposable, already
 * migrated `_test` database:
 *
 *   pnpm --filter @taskdesk/api exec tsx ../../scripts/perf/search-sv5-bench.ts [--iterations=200]
 *
 * The dataset lives in its own organisation/workspace (slug `sv5-bench`) and is reused on
 * later runs. Nothing is printed about the connection.
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { getDatabasePool } from "../../apps/api/src/database";
import {
  searchCanonicalWorkItems,
  searchCanonicalWorkItemsFuzzy,
} from "../../apps/api/src/search/canonical-repository";

const ITEMS = 10_000;
const COMMENTS_PER_ITEM = 4;
const PROJECTS = 4;
const LIMIT = 20;
const WARMUP = 20;
const ITERATIONS = Number(
  process.argv.find((arg) => arg.startsWith("--iterations="))?.split("=")[1] ??
    200,
);
const BENCH_SLUG = "sv5-bench";
const RARE_TERM = "pangolinmarker";
// Common, but only in the oldest half of the items: the newest-first comment probe finds
// nothing and the trigram index path has to carry thousands of matches.
const SKEWED_TERM = "switchover";
const SKEWED_SENTENCE =
  "Planned the datacenter switchover for the core switch.";
const TERMS = [
  RARE_TERM,
  "router logs",
  "restarted",
  "firmware",
  "vpn",
  SKEWED_TERM,
  "zq",
] as const;

function databaseName() {
  const raw = process.env.TASKDESK_DATABASE_URL;
  if (!raw) throw new Error("TASKDESK_DATABASE_URL is not set");
  const name = decodeURIComponent(new URL(raw).pathname.replace(/^\//, ""));
  if (
    !name.endsWith("_test") ||
    name === "taskdesk_browser_journey_1022_test"
  ) {
    throw new Error(
      "Refusing to seed: the benchmark needs a disposable _test database",
    );
  }
  return name;
}

// Realistic help-desk comment sentences. "restarted" and "router logs" are deliberately
// common (the reviewer's typical-query terms); RARE_TERM appears in four comments only.
const COMMENT_SENTENCES = [
  "Restarted the edge router and the link came back after two minutes.",
  "Attached the router logs from this morning; the drops start at 09:12.",
  "Customer restarted the laptop but the VPN client still fails to connect.",
  "Router logs show repeated DHCP renewals on the guest VLAN.",
  "I restarted the print spooler service, please try again.",
  "Waiting on the customer to confirm the issue is resolved.",
  "Escalated to the network team with the router logs attached.",
  "Firmware update scheduled for the weekend maintenance window.",
  "Could not reproduce on a second machine; collecting more details.",
  "Service restarted after the config change, monitoring for an hour.",
  "Replaced the patch cable, link light is green again.",
  "Checked the router logs again: no errors since the restart.",
];

const TITLE_WORDS = [
  "Printer offline on floor",
  "VPN drops every hour",
  "Email sync delayed",
  "Laptop battery swelling",
  "Wi-Fi slow in meeting room",
  "Password reset loop",
  "Shared drive permission denied",
  "Monitor flickers after update",
  "Phone extension not ringing",
  "Badge reader rejects card",
];

function richText(text: string) {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

async function seed(): Promise<{ workspaceId: string; projectIds: string[] }> {
  const pool = getDatabasePool();
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM workspace WHERE slug = $1",
    [BENCH_SLUG],
  );
  if (existing.rows[0]) {
    const projects = await pool.query<{ id: string }>(
      "SELECT id FROM project WHERE workspace_id = $1 ORDER BY slug",
      [existing.rows[0].id],
    );
    return {
      workspaceId: existing.rows[0].id,
      projectIds: projects.rows.map((row) => row.id),
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const organisationId = randomUUID();
    const workspaceId = randomUUID();
    const typeId = randomUUID();
    const templateId = randomUUID();
    await client.query(
      "INSERT INTO organisation (id, key, name) VALUES ($1, $2, 'SV-5 bench')",
      [organisationId, `sv5-bench-${organisationId.slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO workspace (id, name, created_at, slug, organisation_id)
       VALUES ($1, 'SV-5 bench', now(), $2, $3)`,
      [workspaceId, BENCH_SLUG, organisationId],
    );
    await client.query(
      `INSERT INTO work_item_type (id, workspace_id, key, name, category)
       VALUES ($1, $2, 'sv5-task', 'Task', 'delivery')`,
      [typeId, workspaceId],
    );
    await client.query(
      `INSERT INTO state_template (id, workspace_id, key, name, "group")
       VALUES ($1, $2, 'sv5-started', 'Started', 'started')`,
      [templateId, workspaceId],
    );
    const projectIds: string[] = [];
    const stateIds: string[] = [];
    for (let index = 0; index < PROJECTS; index += 1) {
      const projectId = randomUUID();
      const stateId = randomUUID();
      projectIds.push(projectId);
      stateIds.push(stateId);
      await client.query(
        "INSERT INTO project (id, workspace_id, slug, name) VALUES ($1, $2, $3, $4)",
        [projectId, workspaceId, `SVB${index}`, `Bench project ${index}`],
      );
      await client.query(
        `INSERT INTO state (id, project_id, state_template_id, is_default)
         VALUES ($1, $2, $3, true)`,
        [stateId, projectId, templateId],
      );
    }

    // 10,000 items spread over the projects and over a year of creation times; 2% archived
    // and 1% deleted so the scope filters do real work.
    await client.query(
      `INSERT INTO work_item (id, project_id, type_id, number, key, title, description,
                              state_id, workspace_id, created_at, updated_at,
                              archived_at, deleted_at)
       SELECT gen_random_uuid()::text,
              ($1::text[])[1 + (g % $3)],
              $4,
              g / $3 + 1,
              'SVB' || (g % $3) || '-' || (g / $3 + 1),
              ($5::text[])[1 + (g % array_length($5::text[], 1))] || ' #' || g,
              jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
                jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                  jsonb_build_object('type', 'text', 'text',
                    'Reported by the requester. ' ||
                    ($6::text[])[1 + ((g * 7) % array_length($6::text[], 1))]))))),
              ($2::text[])[1 + (g % $3)],
              $7,
              now() - (g || ' minutes')::interval * 50,
              now(),
              CASE WHEN g % 50 = 0 THEN now() END,
              CASE WHEN g % 100 = 1 THEN now() END
         FROM generate_series(0, $8 - 1) AS g`,
      [
        projectIds,
        stateIds,
        PROJECTS,
        typeId,
        TITLE_WORDS,
        COMMENT_SENTENCES,
        workspaceId,
        ITEMS,
      ],
    );

    // 40,000 comments (four per item), 5% soft-deleted. Each body joins two sentences; the
    // first comment of every item in the oldest half carries SKEWED_SENTENCE instead.
    await client.query(
      `INSERT INTO comment (id, workspace_id, work_item_id, actor_type, body,
                            created_at, deleted_at)
       SELECT gen_random_uuid()::text,
              $1,
              wi.id,
              'person',
              jsonb_build_object('type', 'doc', 'content', jsonb_build_array(
                jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                  jsonb_build_object('type', 'text', 'text',
                    CASE WHEN c = 1 AND wi.number > $5 THEN $4 ELSE
                    ($2::text[])[1 + ((wi.number * 3 + c) % array_length($2::text[], 1))]
                    || ' ' ||
                    ($2::text[])[1 + ((wi.number * 5 + c * 7) % array_length($2::text[], 1))]
                    END))))),
              wi.created_at + (c || ' hours')::interval,
              CASE WHEN (wi.number + c) % 20 = 0 THEN now() END
         FROM work_item AS wi
        CROSS JOIN generate_series(1, $3) AS c
        WHERE wi.workspace_id = $1`,
      [
        workspaceId,
        COMMENT_SENTENCES,
        COMMENTS_PER_ITEM,
        SKEWED_SENTENCE,
        ITEMS / PROJECTS / 2,
      ],
    );
    // The rare term: four live comments on four different items.
    await client.query(
      `UPDATE comment SET body = $2::jsonb
        WHERE id IN (SELECT id FROM comment
                      WHERE workspace_id = $1 AND deleted_at IS NULL
                      ORDER BY id LIMIT 4)`,
      [workspaceId, richText(`Found a ${RARE_TERM} in the switch config.`)],
    );
    await client.query("COMMIT");
    // Steady state: VACUUM also flushes the trigram GIN pending lists, which a fresh bulk
    // insert leaves full (a manual ANALYZE does not), so every run measures the same thing.
    await client.query("VACUUM (ANALYZE) work_item");
    await client.query("VACUUM (ANALYZE) comment");
    return { workspaceId, projectIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The controller's work-item path: canonical query, then fuzzy only for an empty page. */
async function runSearch(base: {
  workspaceId: string;
  reachableProjectIds: string[];
  term: string;
}) {
  const rows = await searchCanonicalWorkItems({ ...base, limit: LIMIT });
  if (rows.length > 0) return rows.length;
  const fuzzy = await searchCanonicalWorkItemsFuzzy({
    ...base,
    excludeIds: [],
    limit: LIMIT,
  });
  return fuzzy.length;
}

function percentile(sorted: number[], fraction: number) {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? Number.NaN;
}

async function main() {
  databaseName();
  const { workspaceId, projectIds } = await seed();
  const pool = getDatabasePool();
  const counts = await pool.query<{ items: string; comments: string }>(
    `SELECT (SELECT count(*) FROM work_item WHERE workspace_id = $1) AS items,
            (SELECT count(*) FROM comment WHERE workspace_id = $1) AS comments`,
    [workspaceId],
  );
  const index = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE tablename IN ('comment', 'work_item')
        AND indexname IN ('comment_body_search_idx', 'comment_search_recency_idx',
                          'work_item_search_recency_idx')
      ORDER BY indexname`,
  );
  console.log(
    `SV-5 bench: items=${counts.rows[0]?.items} comments=${counts.rows[0]?.comments} ` +
      `projects=${projectIds.length} limit=${LIMIT} warmup=${WARMUP} iterations=${ITERATIONS}`,
  );
  console.log(
    `indexes: ${index.rows.map((row) => row.indexname).join(", ") || "(none)"}`,
  );
  console.log(
    "metric: wall time of the controller's work-item search path (canonical + fuzzy when empty)",
  );

  for (const term of TERMS) {
    const base = { workspaceId, reachableProjectIds: projectIds, term };
    let rows = 0;
    for (let i = 0; i < WARMUP; i += 1) rows = await runSearch(base);
    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const started = performance.now();
      await runSearch(base);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    console.log(
      `term=${JSON.stringify(term)} rows=${rows} p50=${percentile(samples, 0.5).toFixed(1)}ms ` +
        `p95=${percentile(samples, 0.95).toFixed(1)}ms max=${(samples.at(-1) ?? 0).toFixed(1)}ms`,
    );
  }

  await pool.end().catch(() => undefined);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : "benchmark failed",
  );
  process.exit(1);
});
