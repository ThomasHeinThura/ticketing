import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROBE_ROLE = "taskdesk_rls_probe";
const PROBE_PASSWORD = "rls-prototype-only";
const BASELINE_ROLE = "taskdesk_rls_baseline";
const BASELINE_PASSWORD = "rls-baseline-only";
const GUC_NAME = "taskdesk.rls_organisation_ids";
const ROWS_PER_PROJECT = 300;
const WARMUP_COUNT = 8;
const SAMPLE_COUNT = 40;

type ProjectFixture = {
  id: string;
  workspaceId: string;
  typeId: string;
  stateId: string;
  slug: string;
  organisationId: string;
  isInternal: boolean;
};

type Measurement = {
  operation: string;
  mode: "rls-off" | "rls-on";
  count: number;
  medianMs: number;
  p95Ms: number;
  explain: unknown;
};

type ExplainSummary = {
  executionMs: number | null;
  planningMs: number | null;
  sharedHitBlocks: number;
  sharedReadBlocks: number;
  planNodeTypes: string[];
};

let ownerPool: Pool;
let probePool: Pool;
let measureBaselinePool: Pool;
let projectFixtures: ProjectFixture[];
let organisationIds: { internal: string; customerA: string; customerB: string };

const RLS_POLICIES = [
  "CREATE POLICY rls_proto_work_item_read ON public.work_item FOR SELECT TO taskdesk_rls_probe USING (",
  "  EXISTS (",
  "    SELECT 1 FROM public.workspace AS tenant_workspace",
  "    WHERE tenant_workspace.id = work_item.workspace_id",
  "      AND tenant_workspace.organisation_id = ANY (string_to_array(NULLIF(current_setting('taskdesk.rls_organisation_ids', true), ''), ','))",
  "  )",
  ");",
  "CREATE POLICY rls_proto_comment_read ON public.comment FOR SELECT TO taskdesk_rls_probe USING (",
  "  EXISTS (",
  "    SELECT 1",
  "    FROM public.work_item AS parent_item",
  "    JOIN public.workspace AS tenant_workspace ON tenant_workspace.id = parent_item.workspace_id",
  "    WHERE parent_item.id = comment.work_item_id",
  "      AND parent_item.workspace_id = comment.workspace_id",
  "      AND tenant_workspace.organisation_id = ANY (string_to_array(NULLIF(current_setting('taskdesk.rls_organisation_ids', true), ''), ','))",
  "  )",
  ");",
  "CREATE POLICY rls_proto_attachment_read ON public.attachment FOR SELECT TO taskdesk_rls_probe USING (",
  "  EXISTS (",
  "    SELECT 1 FROM public.workspace AS tenant_workspace",
  "    WHERE tenant_workspace.id = attachment.workspace_id",
  "      AND tenant_workspace.organisation_id = ANY (string_to_array(NULLIF(current_setting('taskdesk.rls_organisation_ids', true), ''), ','))",
  "      AND (attachment.work_item_id IS NULL OR EXISTS (",
  "        SELECT 1 FROM public.work_item AS parent_item",
  "        WHERE parent_item.id = attachment.work_item_id",
  "          AND parent_item.workspace_id = attachment.workspace_id",
  "      ))",
  "      AND (attachment.comment_id IS NULL OR EXISTS (",
  "        SELECT 1 FROM public.comment AS parent_comment",
  "        WHERE parent_comment.id = attachment.comment_id",
  "          AND parent_comment.workspace_id = attachment.workspace_id",
  "      ))",
  "      AND attachment.submission_id IS NULL",
  "  )",
  ");",
].join("\n");

const workItemListSql =
  "SELECT wi.id, wi.key, wi.title, wi.priority, st.name AS state_name " +
  "FROM public.work_item AS wi " +
  "JOIN public.state AS s ON s.id = wi.state_id AND s.project_id = wi.project_id " +
  "JOIN public.state_template AS st ON st.id = s.state_template_id " +
  "WHERE wi.project_id = $1 AND wi.workspace_id = $2 " +
  "AND wi.archived_at IS NULL AND wi.deleted_at IS NULL " +
  "ORDER BY wi.key ASC LIMIT 101";

const commentDetailSql =
  "SELECT id, body, visibility, created_at FROM public.comment " +
  "WHERE work_item_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50";

const attachmentDetailSql =
  "SELECT id, filename, mime_type, size, state FROM public.attachment " +
  "WHERE work_item_id = $1 AND state <> 'deleted' AND deleted_at IS NULL " +
  "ORDER BY created_at ASC LIMIT 50";

function roleUrl(
  containerUrl: string,
  username: string,
  password: string,
): string {
  const url = new URL(containerUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function percentile(values: number[], p: number): number {
  const ordered = sorted(values);
  const index = Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1);
  return ordered[index] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function summarizeExplain(value: unknown): ExplainSummary {
  const top = Array.isArray(value) ? value[0] : undefined;
  const root = top && typeof top === "object" ? top : undefined;
  const plan = root?.Plan;
  const nodes = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const current = node as { "Node Type"?: unknown; Plans?: unknown[] };
    if (typeof current["Node Type"] === "string")
      nodes.add(current["Node Type"]);
    current.Plans?.forEach(visit);
  };
  visit(plan);
  const number = (record: Record<string, unknown> | undefined, key: string) =>
    typeof record?.[key] === "number" ? (record[key] as number) : 0;
  const planRecord =
    plan && typeof plan === "object"
      ? (plan as Record<string, unknown>)
      : undefined;
  const rootRecord = root as Record<string, unknown> | undefined;
  return {
    executionMs:
      typeof rootRecord?.["Execution Time"] === "number"
        ? (rootRecord["Execution Time"] as number)
        : null,
    planningMs:
      typeof rootRecord?.["Planning Time"] === "number"
        ? (rootRecord["Planning Time"] as number)
        : null,
    sharedHitBlocks: number(planRecord, "Shared Hit Blocks"),
    sharedReadBlocks: number(planRecord, "Shared Read Blocks"),
    planNodeTypes: [...nodes].sort(),
  };
}

async function withTransaction<T>(
  pool: Pool,
  organisationScope: string[] | null,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (organisationScope !== null) {
      await client.query("SELECT set_config($1, $2, true)", [
        GUC_NAME,
        organisationScope.join(","),
      ]);
    }
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createFixture() {
  const internalResult = await ownerPool.query<{ id: string }>(
    "SELECT id FROM public.organisation WHERE is_internal = true",
  );
  const internalId = internalResult.rows[0]?.id;
  if (!internalId)
    throw new Error("migrations did not seed the internal organisation");
  const customerAId = "org_customer_a_rls_probe";
  const customerBId = "org_customer_b_rls_probe";
  organisationIds = {
    internal: internalId,
    customerA: customerAId,
    customerB: customerBId,
  };

  const organisations = [
    [customerAId, "customer-a-rls-probe", "Customer A prototype"],
    [customerBId, "customer-b-rls-probe", "Customer B prototype"],
  ] as const;

  for (const [id, key, name] of organisations) {
    await ownerPool.query(
      "INSERT INTO public.organisation (id, key, name, is_internal) VALUES ($1, $2, $3, false)",
      [id, key, name],
    );
  }

  const workspaces = [
    ["ws_internal_rls_probe", internalId],
    ["ws_customer_a_rls_probe", customerAId],
    ["ws_customer_b_rls_probe", customerBId],
  ] as const;
  for (const [id, organisationId] of workspaces) {
    await ownerPool.query(
      "INSERT INTO public.workspace (id, organisation_id, name, slug, created_at) VALUES ($1, $2, $3, $4, now())",
      [id, organisationId, `RLS prototype ${id}`, id],
    );
  }

  projectFixtures = [
    {
      id: "project_internal_rls_probe",
      workspaceId: "ws_internal_rls_probe",
      typeId: "type_internal_rls_probe",
      stateId: "state_internal_rls_probe",
      slug: "internal-rls",
      organisationId: internalId,
      isInternal: true,
    },
    {
      id: "project_customer_a_allowed_rls_probe",
      workspaceId: "ws_customer_a_rls_probe",
      typeId: "type_customer_a_rls_probe",
      stateId: "state_customer_a_allowed_rls_probe",
      slug: "customer-a-allowed",
      organisationId: customerAId,
      isInternal: false,
    },
    {
      id: "project_customer_a_other_rls_probe",
      workspaceId: "ws_customer_a_rls_probe",
      typeId: "type_customer_a_rls_probe",
      stateId: "state_customer_a_other_rls_probe",
      slug: "customer-a-other",
      organisationId: customerAId,
      isInternal: false,
    },
    {
      id: "project_customer_b_allowed_rls_probe",
      workspaceId: "ws_customer_b_rls_probe",
      typeId: "type_customer_b_rls_probe",
      stateId: "state_customer_b_allowed_rls_probe",
      slug: "customer-b-allowed",
      organisationId: customerBId,
      isInternal: false,
    },
  ];

  for (const fixture of projectFixtures) {
    await ownerPool.query(
      "INSERT INTO public.project (id, workspace_id, slug, name) VALUES ($1, $2, $3, $4)",
      [fixture.id, fixture.workspaceId, fixture.slug, fixture.slug],
    );
  }

  for (const fixture of projectFixtures) {
    const typeExists = await ownerPool.query(
      "SELECT 1 FROM public.work_item_type WHERE id = $1",
      [fixture.typeId],
    );
    if (typeExists.rowCount === 0) {
      await ownerPool.query(
        "INSERT INTO public.work_item_type (id, workspace_id, key, name, category) VALUES ($1, $2, $3, $4, 'service')",
        [
          fixture.typeId,
          fixture.workspaceId,
          "request",
          "RLS prototype request",
        ],
      );
    }

    const templateId = `template_${fixture.workspaceId}`;
    const templateExists = await ownerPool.query(
      "SELECT 1 FROM public.state_template WHERE id = $1",
      [templateId],
    );
    if (templateExists.rowCount === 0) {
      await ownerPool.query(
        "INSERT INTO public.state_template (id, workspace_id, key, name, \"group\") VALUES ($1, $2, 'open', 'Open', 'unstarted')",
        [templateId, fixture.workspaceId],
      );
    }

    await ownerPool.query(
      "INSERT INTO public.state (id, project_id, state_template_id, position, is_default) VALUES ($1, $2, $3, 0, true)",
      [fixture.stateId, fixture.id, templateId],
    );
  }

  for (const fixture of projectFixtures) {
    await ownerPool.query(
      "INSERT INTO public.work_item (id, project_id, workspace_id, type_id, number, key, title, state_id, priority, position, created_at, updated_at) " +
        "SELECT $1 || '-wi-' || n, $2, $3, $4, n, $5 || '-' || n, 'Prototype item ' || n, $6, 'medium', n::numeric, " +
        "timestamp '2026-01-01 00:00:00' + n * interval '1 second', timestamp '2026-01-01 00:00:00' + n * interval '1 second' " +
        "FROM generate_series(1, $7::int) AS n",
      [
        fixture.id,
        fixture.id,
        fixture.workspaceId,
        fixture.typeId,
        fixture.slug,
        fixture.stateId,
        ROWS_PER_PROJECT,
      ],
    );
  }

  for (const fixture of projectFixtures) {
    await ownerPool.query(
      "INSERT INTO public.comment (id, workspace_id, work_item_id, actor_type, body, visibility, created_at, updated_at) " +
        "SELECT 'comment-' || wi.id, wi.workspace_id, wi.id, 'system', jsonb_build_object('text', 'prototype comment'), 'internal', wi.created_at + interval '1 millisecond', wi.created_at + interval '1 millisecond' " +
        "FROM public.work_item AS wi WHERE wi.project_id = $1",
      [fixture.id],
    );
  }

  await ownerPool.query(
    "INSERT INTO public.attachment (id, workspace_id, organisation_id, work_item_id, object_key, filename, mime_type, size, state, created_at, updated_at) " +
      "SELECT 'attachment-' || wi.id, wi.workspace_id, CASE WHEN org.is_internal THEN NULL ELSE org.id END, wi.id, " +
      "'prototype/' || wi.id, 'prototype.txt', 'text/plain', 16, 'ready', wi.created_at, wi.created_at " +
      "FROM public.work_item AS wi JOIN public.workspace AS ws ON ws.id = wi.workspace_id " +
      "JOIN public.organisation AS org ON org.id = ws.organisation_id",
  );

  const customerAItem = await ownerPool.query<{
    id: string;
    workspace_id: string;
  }>(
    "SELECT id, workspace_id FROM public.work_item WHERE project_id = $1 ORDER BY number LIMIT 1",
    ["project_customer_a_allowed_rls_probe"],
  );
  const firstCustomerAItem = customerAItem.rows[0];
  if (!firstCustomerAItem) throw new Error("customer A fixture item missing");

  const customerACommentId = `comment-${firstCustomerAItem.id}`;
  await ownerPool.query(
    "INSERT INTO public.attachment (id, workspace_id, organisation_id, comment_id, object_key, filename, mime_type, size, state) VALUES ($1, $2, $3, $4, 'prototype/comment-parent', 'comment.txt', 'text/plain', 8, 'ready')",
    [
      "attachment-comment-parent-prototype",
      firstCustomerAItem.workspace_id,
      customerAId,
      customerACommentId,
    ],
  );

  // This is an intentional denormalization inconsistency, not valid production data:
  // the parent workspace is customer A while the stored quota organisation says B.
  await ownerPool.query(
    "INSERT INTO public.attachment (id, workspace_id, organisation_id, work_item_id, object_key, filename, mime_type, size, state) VALUES ('attachment-org-mismatch-prototype', $1, $2, $3, 'prototype/mismatch', 'mismatch.txt', 'text/plain', 12, 'ready')",
    [firstCustomerAItem.workspace_id, customerBId, firstCustomerAItem.id],
  );

  // The composite FK normally prevents this invalid row. Disable FK triggers only on
  // this Testcontainer transaction to prove the SELECT policy itself also checks the
  // comment's workspace against its authoritative work-item parent.
  const ownerClient = await ownerPool.connect();
  try {
    await ownerClient.query("BEGIN");
    await ownerClient.query("SET LOCAL session_replication_role = replica");
    await ownerClient.query(
      "INSERT INTO public.comment (id, workspace_id, work_item_id, actor_type, body, visibility) VALUES ('comment-parent-workspace-mismatch-prototype', 'ws_customer_b_rls_probe', $1, 'system', '{\"text\":\"invalid fixture\"}'::jsonb, 'internal')",
      [firstCustomerAItem.id],
    );
    await ownerClient.query("COMMIT");
  } catch (error) {
    await ownerClient.query("ROLLBACK");
    throw error;
  } finally {
    ownerClient.release();
  }

  await ownerPool.query("ANALYZE public.work_item");
  await ownerPool.query("ANALYZE public.comment");
  await ownerPool.query("ANALYZE public.attachment");
}

async function configureProbeRoleAndPolicies() {
  await ownerPool.query(
    `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
  );
  await ownerPool.query(
    `CREATE ROLE ${BASELINE_ROLE} LOGIN PASSWORD '${BASELINE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS`,
  );
  for (const role of [PROBE_ROLE, BASELINE_ROLE]) {
    await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await ownerPool.query(
      `GRANT SELECT ON public.workspace, public.organisation, public.project, public.state, public.state_template, public.work_item, public.comment, public.attachment TO ${role}`,
    );
  }

  await ownerPool.query(RLS_POLICIES);
  await ownerPool.query(
    "ALTER TABLE public.work_item ENABLE ROW LEVEL SECURITY",
  );
  await ownerPool.query("ALTER TABLE public.comment ENABLE ROW LEVEL SECURITY");
  await ownerPool.query(
    "ALTER TABLE public.attachment ENABLE ROW LEVEL SECURITY",
  );

  probePool = new Pool({
    connectionString: roleUrl(
      process.env.RLS_PROTOTYPE_DATABASE_URL ?? "",
      PROBE_ROLE,
      PROBE_PASSWORD,
    ),
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
  });
  measureBaselinePool = new Pool({
    connectionString: roleUrl(
      process.env.RLS_PROTOTYPE_DATABASE_URL ?? "",
      BASELINE_ROLE,
      BASELINE_PASSWORD,
    ),
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
  });
}

async function setRlsEnabled(enabled: boolean) {
  const suffix = enabled ? "ENABLE" : "DISABLE";
  for (const table of ["work_item", "comment", "attachment"]) {
    await ownerPool.query(
      `ALTER TABLE public.${table} ${suffix} ROW LEVEL SECURITY`,
    );
  }
}

async function visibleIds(
  table: "work_item" | "comment" | "attachment",
  organisationScope: string[] | null,
): Promise<string[]> {
  return withTransaction(probePool, organisationScope, async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM public.${table} ORDER BY id`,
    );
    return result.rows.map((row) => row.id);
  });
}

async function appTenantIds(
  table: "work_item" | "comment" | "attachment",
  organisationId: string,
): Promise<string[]> {
  let query: string;
  if (table === "work_item") {
    query =
      "SELECT wi.id FROM public.work_item AS wi JOIN public.workspace AS ws ON ws.id = wi.workspace_id WHERE ws.organisation_id = $1 ORDER BY wi.id";
  } else if (table === "comment") {
    query =
      "SELECT c.id FROM public.comment AS c JOIN public.work_item AS wi ON wi.id = c.work_item_id AND wi.workspace_id = c.workspace_id JOIN public.workspace AS ws ON ws.id = wi.workspace_id WHERE ws.organisation_id = $1 ORDER BY c.id";
  } else {
    query =
      "SELECT a.id FROM public.attachment AS a JOIN public.workspace AS ws ON ws.id = a.workspace_id WHERE ws.organisation_id = $1 AND (a.work_item_id IS NULL OR EXISTS (SELECT 1 FROM public.work_item AS wi WHERE wi.id = a.work_item_id AND wi.workspace_id = a.workspace_id)) AND (a.comment_id IS NULL OR EXISTS (SELECT 1 FROM public.comment AS c WHERE c.id = a.comment_id AND c.workspace_id = a.workspace_id)) AND a.submission_id IS NULL ORDER BY a.id";
  }
  return withTransaction(probePool, null, async (client) => {
    const result = await client.query<{ id: string }>(query, [organisationId]);
    return result.rows.map((row) => row.id);
  });
}

async function pairedWorkloadQueries(): Promise<Measurement[]> {
  const customerAProject = projectFixtures.find(
    (fixture) => fixture.id === "project_customer_a_allowed_rls_probe",
  );
  if (!customerAProject) throw new Error("customer A project fixture missing");
  const operations = [
    {
      name: "work_item list page (project/workspace scoped; mirrors list-work-items)",
      sql: workItemListSql,
      params: [customerAProject.id, customerAProject.workspaceId],
    },
    {
      name: "comment detail (parent work_item scoped; mirrors list-work-item-activity)",
      sql: commentDetailSql,
      params: [`${customerAProject.id}-wi-1`],
    },
    {
      name: "attachment detail (work_item scoped; mirrors list-work-item-attachments)",
      sql: attachmentDetailSql,
      params: [`${customerAProject.id}-wi-1`],
    },
  ];
  const measurements: Measurement[] = [];
  const scope = [organisationIds.customerA];

  for (const operation of operations) {
    const samples: Record<Measurement["mode"], number[]> = {
      "rls-off": [],
      "rls-on": [],
    };
    const counts: Record<Measurement["mode"], number> = {
      "rls-off": 0,
      "rls-on": 0,
    };
    for (let i = 0; i < WARMUP_COUNT + SAMPLE_COUNT; i += 1) {
      const order: Measurement["mode"][] =
        i % 2 === 0 ? ["rls-off", "rls-on"] : ["rls-on", "rls-off"];
      for (const mode of order) {
        const pool = mode === "rls-off" ? measureBaselinePool : probePool;
        const tenantScope = mode === "rls-on" ? scope : null;
        const start = performance.now();
        const result = await withTransaction(pool, tenantScope, (client) =>
          client.query(operation.sql, operation.params),
        );
        const elapsed = performance.now() - start;
        counts[mode] = result.rowCount ?? result.rows.length;
        if (i >= WARMUP_COUNT) samples[mode].push(elapsed);
      }
    }

    for (const mode of ["rls-off", "rls-on"] as const) {
      const pool = mode === "rls-off" ? measureBaselinePool : probePool;
      const plan = await withTransaction(
        pool,
        mode === "rls-on" ? scope : null,
        (client) =>
          client.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${operation.sql}`,
            operation.params,
          ),
      );
      measurements.push({
        operation: operation.name,
        mode,
        count: counts[mode],
        medianMs: rounded(percentile(samples[mode], 0.5)),
        p95Ms: rounded(percentile(samples[mode], 0.95)),
        explain: summarizeExplain(plan.rows[0]?.["QUERY PLAN"]),
      });
    }
  }
  return measurements;
}

describe("P0 RLS prototype — isolated, test-only evidence", () => {
  beforeAll(async () => {
    const containerUrl = process.env.RLS_PROTOTYPE_DATABASE_URL;
    if (!containerUrl) {
      throw new Error(
        "RLS_PROTOTYPE_DATABASE_URL is only set by this suite's Testcontainers globalSetup",
      );
    }
    ownerPool = new Pool({ connectionString: containerUrl, max: 4 });
    await migrate(drizzle(ownerPool), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
    await createFixture();
    await configureProbeRoleAndPolicies();
  }, 180_000);

  afterAll(async () => {
    await probePool?.end();
    await measureBaselinePool?.end();
    await ownerPool?.end();
  }, 30_000);

  it("measures pooling, tenant agreement, parent consistency, and hot-read overhead", async () => {
    const customerA = [organisationIds.customerA];
    const internalStaffScope = [
      organisationIds.internal,
      organisationIds.customerA,
      organisationIds.customerB,
    ];

    // One pooled backend is deliberately reused through a commit then a rollback.
    // The next borrower gets no inherited tenant context and therefore sees no rows.
    const firstClient = await probePool.connect();
    const backendPid = (
      await firstClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]?.pid;
    if (backendPid === undefined) throw new Error("missing pooled backend PID");
    await firstClient.query("BEGIN");
    await firstClient.query("SELECT set_config($1, $2, true)", [
      GUC_NAME,
      customerA.join(","),
    ]);
    const customerAWorkItems = await firstClient.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.work_item",
    );
    expect(Number(customerAWorkItems.rows[0]?.count)).toBe(
      ROWS_PER_PROJECT * 2,
    );
    await firstClient.query("COMMIT");
    firstClient.release();

    const secondClient = await probePool.connect();
    const reusedPid = (
      await secondClient.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      )
    ).rows[0]?.pid;
    expect(reusedPid).toBe(backendPid);
    await secondClient.query("BEGIN");
    const resetContext = await secondClient.query<{
      current_value: string | null;
    }>("SELECT NULLIF(current_setting($1, true), '') AS current_value", [
      GUC_NAME,
    ]);
    expect(resetContext.rows[0]?.current_value ?? null).toBeNull();
    const noTenantRows = await secondClient.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.work_item",
    );
    expect(Number(noTenantRows.rows[0]?.count)).toBe(0);
    await secondClient.query("SELECT set_config($1, $2, true)", [
      GUC_NAME,
      organisationIds.customerB,
    ]);
    const customerBWorkItems = await secondClient.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.work_item",
    );
    expect(Number(customerBWorkItems.rows[0]?.count)).toBe(ROWS_PER_PROJECT);
    await secondClient.query("ROLLBACK");
    secondClient.release();

    const thirdClient = await probePool.connect();
    const thirdPid = (
      await thirdClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
    ).rows[0]?.pid;
    expect(thirdPid).toBe(backendPid);
    await thirdClient.query("BEGIN");
    const afterRollbackContext = await thirdClient.query<{
      current_value: string | null;
    }>("SELECT NULLIF(current_setting($1, true), '') AS current_value", [
      GUC_NAME,
    ]);
    expect(afterRollbackContext.rows[0]?.current_value ?? null).toBeNull();
    const noRowsAfterRollback = await thirdClient.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.work_item",
    );
    expect(Number(noRowsAfterRollback.rows[0]?.count)).toBe(0);
    await thirdClient.query("SELECT set_config($1, '', true)", [GUC_NAME]);
    const emptyScopeRows = await thirdClient.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.work_item",
    );
    expect(Number(emptyScopeRows.rows[0]?.count)).toBe(0);
    await thirdClient.query("ROLLBACK");
    thirdClient.release();

    // The GUC itself is caller-controlled by a database session. This proves the
    // policy is only a backstop when the application derives the scope from trusted
    // authorization context; a SQL-capable caller can otherwise select another scope.
    const callerChosenOtherTenantRows = await withTransaction(
      probePool,
      [organisationIds.customerB],
      async (client) => {
        const result = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM public.work_item",
        );
        return Number(result.rows[0]?.count);
      },
    );
    expect(callerChosenOtherTenantRows).toBe(ROWS_PER_PROJECT);

    // Capture application tenant-boundary results while RLS is disabled. The subsequent
    // RLS reads contain no explicit organisation WHERE clause.
    await setRlsEnabled(false);
    const appTenantBaseline = {
      work_item: await appTenantIds("work_item", organisationIds.customerA),
      comment: await appTenantIds("comment", organisationIds.customerA),
      attachment: await appTenantIds("attachment", organisationIds.customerA),
    };
    const appStaffProjects = await withTransaction(
      probePool,
      null,
      async (client) => {
        const result = await client.query<{ id: string }>(
          "SELECT id FROM public.work_item WHERE project_id = ANY($1::text[]) ORDER BY id",
          [
            [
              "project_internal_rls_probe",
              "project_customer_a_allowed_rls_probe",
              "project_customer_b_allowed_rls_probe",
            ],
          ],
        );
        return result.rows.map((row) => row.id);
      },
    );

    await setRlsEnabled(true);
    const rlsCustomerA = {
      work_item: await visibleIds("work_item", customerA),
      comment: await visibleIds("comment", customerA),
      attachment: await visibleIds("attachment", customerA),
    };
    expect(rlsCustomerA.work_item.sort()).toEqual(
      appTenantBaseline.work_item.sort(),
    );
    expect(rlsCustomerA.comment.sort()).toEqual(
      appTenantBaseline.comment.sort(),
    );
    expect(rlsCustomerA.attachment.sort()).toEqual(
      appTenantBaseline.attachment.sort(),
    );

    const rlsStaffReach = {
      work_item: await visibleIds("work_item", internalStaffScope),
      comment: await visibleIds("comment", internalStaffScope),
      attachment: await visibleIds("attachment", internalStaffScope),
    };
    const staffProjectExtra = rlsStaffReach.work_item.filter(
      (id) => !appStaffProjects.includes(id),
    );
    expect(appStaffProjects.length).toBe(ROWS_PER_PROJECT * 3);
    expect(staffProjectExtra.length).toBe(ROWS_PER_PROJECT);

    // Attachment.organisation_id is documented as NULL for internal data and the
    // customer ID otherwise. Derive expected value from the authoritative parent
    // workspace rather than trusting the denormalized value.
    const attachmentMismatch = await ownerPool.query<{
      attachment_id: string;
      stored_organisation_id: string | null;
      parent_organisation_id: string;
      is_internal: boolean;
    }>(
      "SELECT a.id AS attachment_id, a.organisation_id AS stored_organisation_id, ws.organisation_id AS parent_organisation_id, org.is_internal " +
        "FROM public.attachment AS a JOIN public.workspace AS ws ON ws.id = a.workspace_id " +
        "JOIN public.organisation AS org ON org.id = ws.organisation_id " +
        "WHERE a.organisation_id IS DISTINCT FROM CASE WHEN org.is_internal THEN NULL ELSE org.id END " +
        "ORDER BY a.id",
    );
    expect(attachmentMismatch.rows.map((row) => row.attachment_id)).toEqual([
      "attachment-org-mismatch-prototype",
    ]);

    const commentWorkspaceMismatch = await ownerPool.query<{ id: string }>(
      "SELECT c.id FROM public.comment AS c JOIN public.work_item AS wi ON wi.id = c.work_item_id " +
        "WHERE c.workspace_id IS DISTINCT FROM wi.workspace_id ORDER BY c.id",
    );
    expect(commentWorkspaceMismatch.rows.map((row) => row.id)).toEqual([
      "comment-parent-workspace-mismatch-prototype",
    ]);
    expect(
      rlsCustomerA.comment.includes(
        "comment-parent-workspace-mismatch-prototype",
      ),
    ).toBe(false);

    // This measurement intentionally compares tenant RLS with project-level actor
    // reach separately. The extra same-organisation project demonstrates that RLS is
    // a tenant backstop, not the evaluator's project/actor authorization decision.
    const mismatchEvidence = {
      customerATenantCounts: {
        work_item: rlsCustomerA.work_item.length,
        comment: rlsCustomerA.comment.length,
        attachment: rlsCustomerA.attachment.length,
      },
      internalStaffReachCounts: {
        work_item: rlsStaffReach.work_item.length,
        comment: rlsStaffReach.comment.length,
        attachment: rlsStaffReach.attachment.length,
      },
      projectLevelActorRows: appStaffProjects.length,
      extraRowsPermittedByTenantBackstop: staffProjectExtra.length,
      attachmentParentOrganisationMismatchRows: attachmentMismatch.rows,
      commentParentWorkspaceMismatchRows: commentWorkspaceMismatch.rows.map(
        (row) => row.id,
      ),
    };

    await setRlsEnabled(true);
    const pairedTimings = await pairedWorkloadQueries();

    const report = {
      database:
        "PostgreSQL 18 Testcontainer; real main migrations; isolated database",
      fixture: {
        rowsPerProject: ROWS_PER_PROJECT,
        workItems: ROWS_PER_PROJECT * projectFixtures.length,
        comments: ROWS_PER_PROJECT * projectFixtures.length + 1,
        attachments: ROWS_PER_PROJECT * projectFixtures.length + 2,
      },
      poolReuse: {
        backendPid,
        reusedPid,
        afterCommitRows: Number(customerAWorkItems.rows[0]?.count),
        afterCommitUnsetRows: Number(noTenantRows.rows[0]?.count),
        afterRollbackUnsetRows: Number(noRowsAfterRollback.rows[0]?.count),
        emptyScopeRows: Number(emptyScopeRows.rows[0]?.count),
        customerBRowsInsideRolledBackTransaction: Number(
          customerBWorkItems.rows[0]?.count,
        ),
        callerCanSelectAnotherScopeViaGuc: callerChosenOtherTenantRows,
      },
      boundary: mismatchEvidence,
      timings: pairedTimings,
      measurementLimits: [
        "Single local Testcontainer, 1,202 work items total, one 40-sample warmed run per query/mode; not a production forecast.",
        "The custom GUC is settable by the database role. RLS is not an independent identity authority: the application must derive and bind the scope from trusted authorization state, and the runtime role must not bypass row security.",
        "Queries mirror the current work-item list, comment activity, and attachment list access shapes, but this isolated harness does not invoke HTTP routes or install an application GUC wrapper.",
        "RLS was disabled/enabled on the same migrated tables and data; no production migration or schema was modified.",
      ],
    };
    console.info(`RLS_PROTOTYPE_RESULTS ${JSON.stringify(report)}`);

    expect(rlsStaffReach.work_item).toHaveLength(ROWS_PER_PROJECT * 4);
    expect(rlsStaffReach.comment).toHaveLength(ROWS_PER_PROJECT * 4);
    expect(rlsStaffReach.attachment).toHaveLength(ROWS_PER_PROJECT * 4 + 2);
    expect(
      rlsStaffReach.work_item.some((id) => appStaffProjects.includes(id)),
    ).toBe(true);
  }, 180_000);
});
