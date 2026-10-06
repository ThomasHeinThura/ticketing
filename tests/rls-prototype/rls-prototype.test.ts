import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultRolePayloads } from "../../packages/permissions/src/legacy-better-auth-access-control";

const PROBE_ROLE = "taskdesk_rls_probe";
const BASELINE_ROLE = "taskdesk_rls_baseline";
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
let directProbePool: Pool;
let measureBaselinePool: Pool;
let pgbouncerAdminPool: Pool;
let logicalClientAPool: Pool;
let logicalClientBPool: Pool;
let projectFixtures: ProjectFixture[];
let organisationIds: { internal: string; customerA: string; customerB: string };
let probePassword: string;
let baselinePassword: string;
let databaseName: string;
let applicationDatabaseModule:
  | typeof import("../../apps/api/src/database")
  | undefined;

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

async function withOpenTenantTransaction<T>(
  client: PoolClient,
  organisationId: string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config($1, $2, true)", [
      GUC_NAME,
      organisationId,
    ]);
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
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
    `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${probePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
  );
  await ownerPool.query(
    `CREATE ROLE ${BASELINE_ROLE} LOGIN PASSWORD '${baselinePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS`,
  );
  for (const role of [PROBE_ROLE, BASELINE_ROLE]) {
    await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await ownerPool.query(
      `GRANT SELECT ON public.workspace, public.organisation, public.project, public.state, public.state_template, public.work_item, public.comment, public.attachment TO ${role}`,
    );
  }
  // The application read-path probe runs with the same non-owner NOBYPASSRLS role,
  // while prototype RLS is explicitly disabled for its baseline requests. Give that
  // disposable role read-only access to the route's auth, membership, identity and
  // projection tables as well as the three policy tables.
  await ownerPool.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`,
  );

  await ownerPool.query(RLS_POLICIES);
  await ownerPool.query(
    "ALTER TABLE public.work_item ENABLE ROW LEVEL SECURITY",
  );
  await ownerPool.query("ALTER TABLE public.comment ENABLE ROW LEVEL SECURITY");
  await ownerPool.query(
    "ALTER TABLE public.attachment ENABLE ROW LEVEL SECURITY",
  );

  const directProbeUrl = roleUrl(
    process.env.RLS_PROTOTYPE_DATABASE_URL ?? "",
    PROBE_ROLE,
    probePassword,
  );
  const pgbouncerUrl = process.env.RLS_PROTOTYPE_PGBOUNCER_URL;
  if (!pgbouncerUrl) throw new Error("PgBouncer Testcontainer URL missing");
  probePool = new Pool({
    connectionString: pgbouncerUrl,
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
  });
  directProbePool = new Pool({
    connectionString: directProbeUrl,
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
  });
  const adminUrl = new URL(pgbouncerUrl);
  adminUrl.username = "postgres";
  adminUrl.password = "";
  adminUrl.pathname = "/pgbouncer";
  pgbouncerAdminPool = new Pool({
    connectionString: adminUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  logicalClientAPool = new Pool({
    connectionString: pgbouncerUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  logicalClientBPool = new Pool({
    connectionString: pgbouncerUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  measureBaselinePool = new Pool({
    connectionString: roleUrl(
      process.env.RLS_PROTOTYPE_DATABASE_URL ?? "",
      BASELINE_ROLE,
      baselinePassword,
    ),
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
  });
}

type ApplicationStaffActor = {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
    role: string | null;
    banned: boolean;
  };
  workspaces: string[];
};

async function seedApplicationStaffActor(
  actorId: string,
  workspaceIds: string[],
): Promise<ApplicationStaffActor> {
  const userId = `user_${actorId}`;
  const insertedUser = await ownerPool.query<ApplicationStaffActor["user"]>(
    'INSERT INTO public."user" (id, name, email, email_verified, role, banned) VALUES ($1, $2, $3, true, NULL, false) ' +
      'RETURNING id, name, email, email_verified AS "emailVerified", image, created_at AS "createdAt", updated_at AS "updatedAt", role, banned',
    [userId, `RLS prototype ${actorId}`, `${actorId}@rls-prototype.invalid`],
  );
  const user = insertedUser.rows[0];
  if (!user) throw new Error(`Failed to seed ${actorId} user`);

  await ownerPool.query(
    "INSERT INTO public.person (id, user_id, organisation_id, side, active) VALUES ($1, $2, $3, 'staff', true)",
    [`person_${actorId}`, userId, organisationIds.internal],
  );

  for (const workspaceId of workspaceIds) {
    await ownerPool.query(
      "INSERT INTO public.workspace_role (id, workspace_id, role, permission, is_system) VALUES ($1, $2, 'member', $3, true) ON CONFLICT (workspace_id, role) DO NOTHING",
      [
        `role_member_${actorId}_${workspaceId}`,
        workspaceId,
        JSON.stringify(defaultRolePayloads.member),
      ],
    );
    await ownerPool.query(
      "INSERT INTO public.workspace_member (id, workspace_id, user_id, role, joined_at) VALUES ($1, $2, $3, 'member', now())",
      [`membership_${actorId}_${workspaceId}`, workspaceId, userId],
    );
  }

  return { user, workspaces: workspaceIds };
}

async function loadApplicationReadPath() {
  const containerUrl = process.env.RLS_PROTOTYPE_DATABASE_URL;
  if (!containerUrl) throw new Error("Prototype Testcontainer URL missing");
  // Set the container URL before importing any app/database/auth module. Use the
  // isolated NOBYPASSRLS probe role; never inherit a developer or shared DB URL.
  process.env.TASKDESK_DATABASE_URL = roleUrl(
    containerUrl,
    PROBE_ROLE,
    probePassword,
  );
  process.env.TASKDESK_AUTH_SECRET =
    "rls-prototype-test-secret-with-more-than-32-characters";

  const [apiModule, authFixture, identityModule, databaseModule] =
    await Promise.all([
      import("../../apps/api/src/index"),
      import("../api-integration/helpers/auth"),
      import("../../apps/api/src/permissions/resolve-identity"),
      import("../../apps/api/src/database"),
    ]);
  applicationDatabaseModule = databaseModule;
  const app = apiModule.createApp().app;

  const connectedAs = await databaseModule.getDatabasePool().query<{
    current_user: string;
    current_database: string;
  }>("SELECT current_user, current_database()");
  expect(connectedAs.rows[0]).toEqual({
    current_user: PROBE_ROLE,
    current_database: databaseName,
  });

  async function requestAsStaff(
    actor: ApplicationStaffActor,
    path: string,
  ): Promise<Response> {
    const mock = authFixture.mockAuthenticatedSession(
      actor.user as Parameters<typeof authFixture.mockAuthenticatedSession>[0],
    );
    try {
      return await app.request(path);
    } finally {
      mock.mockRestore();
    }
  }

  return {
    app,
    requestAsStaff,
    resolveIdentity: identityModule.resolveIdentity,
  };
}

function digestIds(ids: string[]): string {
  return createHash("sha256")
    .update([...ids].sort().join("\n"))
    .digest("hex");
}

async function listAllWorkItemIds(
  requestAsStaff: (
    actor: ApplicationStaffActor,
    path: string,
  ) => Promise<Response>,
  actor: ApplicationStaffActor,
  project: ProjectFixture,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await requestAsStaff(
      actor,
      `/api/projects/${project.id}/work-items?${query.toString()}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string }>;
      page: { nextCursor: string | null; hasMore: boolean };
      meta: { total: number };
    };
    ids.push(...body.data.map((item) => item.id));
    cursor = body.page.nextCursor;
    pages += 1;
    expect(pages).toBeLessThanOrEqual(ROWS_PER_PROJECT);
    expect(body.meta.total).toBe(ROWS_PER_PROJECT);
  } while (cursor);
  expect(ids).toHaveLength(ROWS_PER_PROJECT);
  return ids.sort();
}

async function visibleParentIds(
  table: "comment" | "attachment",
  parentWorkItemId: string,
  organisationScope: string,
): Promise<string[]> {
  return withTransaction(probePool, [organisationScope], async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM public.${table} WHERE work_item_id = $1 ORDER BY id`,
      [parentWorkItemId],
    );
    return result.rows.map((row) => row.id);
  });
}

async function compareApplicationReadPaths() {
  const internalWorkspace = "ws_internal_rls_probe";
  const customerAWorkspace = "ws_customer_a_rls_probe";
  const customerBWorkspace = "ws_customer_b_rls_probe";
  const customerAStaff = await seedApplicationStaffActor(
    "staff_customer_a_workspace",
    [customerAWorkspace],
  );
  const internalCrossOrganisationStaff = await seedApplicationStaffActor(
    "staff_internal_cross_organisation",
    [internalWorkspace, customerAWorkspace, customerBWorkspace],
  );

  const application = await loadApplicationReadPath();
  for (const actor of [customerAStaff, internalCrossOrganisationStaff]) {
    const identity = await application.resolveIdentity({
      userId: actor.user.id,
      credential: "session",
    });
    expect(identity?.side).toBe("staff");
    expect(identity?.organisationId).toBe(organisationIds.internal);
  }

  // Read the actual Hono route and list-work-items controller with all four real
  // project fixtures. Page all 300 rows for each project; there is no handwritten
  // application SQL in this comparison.
  const customerAProjects = projectFixtures.filter(
    (project) => project.organisationId === organisationIds.customerA,
  );
  const customerAActualWorkItems: string[] = [];
  for (const project of customerAProjects) {
    customerAActualWorkItems.push(
      ...(await listAllWorkItemIds(
        application.requestAsStaff,
        customerAStaff,
        project,
      )),
    );
  }
  const deniedResponse = await application.requestAsStaff(
    customerAStaff,
    "/api/projects/project_customer_b_allowed_rls_probe/work-items",
  );
  expect(deniedResponse.status).toBe(400);

  const internalStaffActualWorkItems: string[] = [];
  for (const project of projectFixtures) {
    internalStaffActualWorkItems.push(
      ...(await listAllWorkItemIds(
        application.requestAsStaff,
        internalCrossOrganisationStaff,
        project,
      )),
    );
  }

  const commentsAndAttachments: Array<{
    projectId: string;
    actor: "customer-a-workspace-staff" | "internal-cross-organisation-staff";
    commentRouteIds: string[];
    rlsCommentIds: string[];
    attachmentRouteIds: string[];
    rlsAttachmentIds: string[];
  }> = [];
  for (const project of projectFixtures) {
    const actor =
      project.organisationId === organisationIds.customerA
        ? customerAStaff
        : internalCrossOrganisationStaff;
    const audience =
      actor === customerAStaff
        ? "customer-a-workspace-staff"
        : "internal-cross-organisation-staff";
    const workItemKey = `${project.slug}-1`;
    const activityResponse = await application.requestAsStaff(
      actor,
      `/api/work-items/${workItemKey}/activity`,
    );
    expect(activityResponse.status).toBe(200);
    const activityBody = (await activityResponse.json()) as {
      data: Array<{ id: string; kind: string }>;
    };
    const commentRouteIds = activityBody.data
      .filter((row) => row.kind === "comment")
      .map((row) => row.id)
      .sort();
    const attachmentResponse = await application.requestAsStaff(
      actor,
      `/api/work-items/${workItemKey}/attachments`,
    );
    expect(attachmentResponse.status).toBe(200);
    const attachmentBody = (await attachmentResponse.json()) as Array<{
      id: string;
    }>;
    const attachmentRouteIds = attachmentBody.map((row) => row.id).sort();
    commentsAndAttachments.push({
      projectId: project.id,
      actor: audience,
      commentRouteIds,
      rlsCommentIds: [],
      attachmentRouteIds,
      rlsAttachmentIds: [],
    });
  }

  // Re-enable the prototype policies only after the real Hono reads finish. The RLS
  // pools then collect the same targeted parent reads and the full work-item sets.
  await setRlsEnabled(true);
  for (const sample of commentsAndAttachments) {
    const project = projectFixtures.find(
      (fixture) => fixture.id === sample.projectId,
    );
    if (!project)
      throw new Error(`Missing project fixture ${sample.projectId}`);
    const workItemId = `${project.id}-wi-1`;
    sample.rlsCommentIds = await visibleParentIds(
      "comment",
      workItemId,
      project.organisationId,
    );
    sample.rlsAttachmentIds = await visibleParentIds(
      "attachment",
      workItemId,
      project.organisationId,
    );
  }

  const commentMismatch = commentsAndAttachments.filter(
    (sample) =>
      JSON.stringify(sample.commentRouteIds) !==
      JSON.stringify(sample.rlsCommentIds),
  );
  const attachmentMismatch = commentsAndAttachments.filter(
    (sample) =>
      JSON.stringify(sample.attachmentRouteIds) !==
      JSON.stringify(sample.rlsAttachmentIds),
  );
  const expectedCorruptCommentMismatch = commentMismatch.filter(
    (sample) =>
      sample.commentRouteIds.includes(
        "comment-parent-workspace-mismatch-prototype",
      ) &&
      !sample.rlsCommentIds.includes(
        "comment-parent-workspace-mismatch-prototype",
      ),
  );
  expect(commentMismatch).toHaveLength(1);
  expect(expectedCorruptCommentMismatch).toHaveLength(1);
  expect(attachmentMismatch).toHaveLength(0);

  const rlsCustomerA = await visibleIds("work_item", [
    organisationIds.customerA,
  ]);
  const rlsInternalStaff = await visibleIds("work_item", [
    organisationIds.internal,
    organisationIds.customerA,
    organisationIds.customerB,
  ]);
  expect(customerAActualWorkItems.sort()).toEqual(rlsCustomerA.sort());
  expect(internalStaffActualWorkItems.sort()).toEqual(rlsInternalStaff.sort());
  await setRlsEnabled(false);

  return {
    customerADataScope: {
      audience: "staff principal with explicit customer-A workspace membership",
      noCustomerPrincipalTested: true,
      outOfWorkspaceCustomerBStatus: deniedResponse.status,
      actualWorkItemRows: customerAActualWorkItems.length,
      actualWorkItemSha256: digestIds(customerAActualWorkItems),
      rlsWorkItemRows: rlsCustomerA.length,
      rlsWorkItemSha256: digestIds(rlsCustomerA),
    },
    internalCrossOrganisationStaff: {
      identitySide: "staff",
      homeOrganisationId: organisationIds.internal,
      explicitWorkspaceMemberships: internalCrossOrganisationStaff.workspaces,
      actualWorkItemRows: internalStaffActualWorkItems.length,
      actualWorkItemSha256: digestIds(internalStaffActualWorkItems),
      rlsWorkItemRows: rlsInternalStaff.length,
      rlsWorkItemSha256: digestIds(rlsInternalStaff),
    },
    sampleReadRoutes: commentsAndAttachments.map((sample) => ({
      ...sample,
      commentMismatchIds: sample.commentRouteIds.filter(
        (id) => !sample.rlsCommentIds.includes(id),
      ),
      attachmentMismatchIds: sample.attachmentRouteIds.filter(
        (id) => !sample.rlsAttachmentIds.includes(id),
      ),
    })),
    applicationReadLimitations: [
      "These actual read requests use internal staff persons/users and explicit workspace memberships; this test creates no customer principal and exercises no customer portal agent access.",
      "The live work-item route authorizes workspace membership, not project membership or sees_all. The identity resolver currently reports staff reach from memberships (seesAll is false); project-level actor authorization remains a separate, not-integrated control.",
      "The app pool uses the isolated NOBYPASSRLS SELECT role while prototype RLS is disabled for baseline reads. RLS comparison uses the separate NOBYPASSRLS probe pool with transaction-local organisation scope.",
      "For comments and attachments, actual Hono routes/controller reads are checked on one deterministic work item in each project; work-item list rows are fully paginated across every fixture project.",
      "The invalid comment row exists only because the disposable fixture disables FK triggers for insertion. The actual activity route returns that malformed row, while the parent-consistency RLS policy rejects it; the production composite FK prevents this fixture state.",
    ],
  };
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

async function idsOnClient(
  client: PoolClient,
  table: "work_item" | "comment" | "attachment",
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM public.${table} ORDER BY id`,
  );
  return result.rows.map((row) => row.id);
}

function normalizeScope(value: string | null): string {
  return value ? value : "UNSET";
}

async function expectedTenantIdsFromPrototypePredicate(
  table: "work_item" | "comment" | "attachment",
  organisationId: string,
  pool: Pool = probePool,
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
  return withTransaction(pool, null, async (client) => {
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
        const pool = mode === "rls-off" ? measureBaselinePool : directProbePool;
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
      const pool = mode === "rls-off" ? measureBaselinePool : directProbePool;
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
    probePassword = process.env.RLS_PROTOTYPE_PROBE_PASSWORD ?? "";
    baselinePassword = process.env.RLS_PROTOTYPE_BASELINE_PASSWORD ?? "";
    databaseName = decodeURIComponent(new URL(containerUrl).pathname.slice(1));
    if (!probePassword || !baselinePassword || !databaseName) {
      throw new Error("Isolated RLS prototype credentials or database missing");
    }
    ownerPool = new Pool({ connectionString: containerUrl, max: 4 });
    const verifiedTarget = await ownerPool.query<{
      current_user: string;
      current_database: string;
    }>("SELECT current_user, current_database()");
    expect(verifiedTarget.rows[0]).toEqual({
      current_user: "postgres",
      current_database: databaseName,
    });
    await migrate(drizzle(ownerPool), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
    await createFixture();
    await configureProbeRoleAndPolicies();
  }, 180_000);

  afterAll(async () => {
    await probePool?.end();
    await directProbePool?.end();
    await measureBaselinePool?.end();
    await pgbouncerAdminPool?.end();
    await logicalClientAPool?.end();
    await logicalClientBPool?.end();
    if (applicationDatabaseModule) {
      await applicationDatabaseModule.getDatabasePool().end();
      applicationDatabaseModule = undefined;
    }
    await ownerPool?.end();
    delete process.env.TASKDESK_DATABASE_URL;
    delete process.env.TASKDESK_AUTH_SECRET;
  }, 30_000);

  it("isolates tenant scope through a real PgBouncer transaction pool", async () => {
    const postgresVersion = (
      await ownerPool.query<{ server_version: string }>("SHOW server_version")
    ).rows[0]?.server_version;
    expect(postgresVersion).toMatch(/^18\./);

    const versionResult = await pgbouncerAdminPool.query<{
      version: string;
      libevent: string;
    }>("SHOW VERSION");
    const version = versionResult.rows[0]?.version;
    expect(version).toContain("1.25.2");

    const configResult = await pgbouncerAdminPool.query<{
      key: string;
      value: string;
    }>("SHOW CONFIG");
    const config = new Map(
      configResult.rows.map(({ key, value }) => [key, value]),
    );
    expect(config.get("pool_mode")).toBe("transaction");
    expect(config.get("default_pool_size")).toBe("1");

    const endpoint = await probePool.query<{
      current_user: string;
      current_database: string;
    }>("SELECT current_user, current_database()");
    expect(endpoint.rows[0]).toEqual({
      current_user: PROBE_ROLE,
      current_database: databaseName,
    });

    const role = await ownerPool.query<{
      is_superuser: boolean;
      bypasses_rls: boolean;
      owns_work_item: boolean;
    }>(
      "SELECT r.rolsuper AS is_superuser, r.rolbypassrls AS bypasses_rls, c.relowner = r.oid AS owns_work_item " +
        "FROM pg_roles AS r CROSS JOIN pg_class AS c " +
        "WHERE r.rolname = $1 AND c.oid = 'public.work_item'::regclass",
      [PROBE_ROLE],
    );
    expect(role.rows[0]).toEqual({
      is_superuser: false,
      bypasses_rls: false,
      owns_work_item: false,
    });

    const expectedIds: Record<
      "customerA" | "customerB",
      Record<"work_item" | "comment" | "attachment", string[]>
    > = {
      customerA: { work_item: [], comment: [], attachment: [] },
      customerB: { work_item: [], comment: [], attachment: [] },
    };
    await setRlsEnabled(false);
    try {
      for (const table of ["work_item", "comment", "attachment"] as const) {
        expectedIds.customerA[table] =
          await expectedTenantIdsFromPrototypePredicate(
            table,
            organisationIds.customerA,
            ownerPool,
          );
        expectedIds.customerB[table] =
          await expectedTenantIdsFromPrototypePredicate(
            table,
            organisationIds.customerB,
            ownerPool,
          );
      }
    } finally {
      await setRlsEnabled(true);
    }

    const clientA = await logicalClientAPool.connect();
    const clientB = await logicalClientBPool.connect();
    expect(clientA).not.toBe(clientB);
    try {
      const aPid = await withOpenTenantTransaction(
        clientA,
        organisationIds.customerA,
        async () => {
          const pid = (
            await clientA.query<{ pid: number }>(
              "SELECT pg_backend_pid() AS pid",
            )
          ).rows[0]?.pid;
          if (pid === undefined)
            throw new Error("missing PgBouncer backend PID");
          for (const table of ["work_item", "comment", "attachment"] as const) {
            expect(await idsOnClient(clientA, table)).toEqual(
              expectedIds.customerA[table],
            );
          }
          return pid;
        },
      );

      await clientB.query("BEGIN");
      const bPid = (
        await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]?.pid;
      expect(bPid).toBe(aPid);
      const afterCommitScope = await clientB.query<{ scope: string | null }>(
        "SELECT NULLIF(current_setting($1, true), '') AS scope",
        [GUC_NAME],
      );
      expect(normalizeScope(afterCommitScope.rows[0]?.scope ?? null)).toBe(
        "UNSET",
      );
      for (const table of ["work_item", "comment", "attachment"] as const) {
        expect(await idsOnClient(clientB, table)).toEqual([]);
      }
      await clientB.query("SELECT set_config($1, '', true)", [GUC_NAME]);
      for (const table of ["work_item", "comment", "attachment"] as const) {
        expect(await idsOnClient(clientB, table)).toEqual([]);
      }
      await clientB.query("SELECT set_config($1, $2, true)", [
        GUC_NAME,
        organisationIds.customerB,
      ]);
      for (const table of ["work_item", "comment", "attachment"] as const) {
        expect(await idsOnClient(clientB, table)).toEqual(
          expectedIds.customerB[table],
        );
      }
      await clientB.query("COMMIT");

      await clientA.query("BEGIN");
      await clientA.query("SELECT set_config($1, $2, true)", [
        GUC_NAME,
        organisationIds.customerA,
      ]);
      expect(await idsOnClient(clientA, "work_item")).toEqual(
        expectedIds.customerA.work_item,
      );
      const rollbackPid = (
        await clientA.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]?.pid;
      expect(rollbackPid).toBe(aPid);
      await clientA.query("ROLLBACK");

      await clientB.query("BEGIN");
      const rollbackScope = await clientB.query<{ scope: string | null }>(
        "SELECT NULLIF(current_setting($1, true), '') AS scope",
        [GUC_NAME],
      );
      expect(normalizeScope(rollbackScope.rows[0]?.scope ?? null)).toBe(
        "UNSET",
      );
      for (const table of ["work_item", "comment", "attachment"] as const) {
        expect(await idsOnClient(clientB, table)).toEqual([]);
      }
      await clientB.query("COMMIT");

      let signalAReady: () => void = () => {};
      let signalAFailed: (error: unknown) => void = () => {};
      const aReady = new Promise<void>((resolve, reject) => {
        signalAReady = resolve;
        signalAFailed = reject;
      });
      let releaseA: () => void = () => {};
      const holdA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      const aConcurrent = (async () => {
        try {
          await clientA.query("BEGIN");
          await clientA.query("SELECT set_config($1, $2, true)", [
            GUC_NAME,
            organisationIds.customerA,
          ]);
          const pid = (
            await clientA.query<{ pid: number }>(
              "SELECT pg_backend_pid() AS pid",
            )
          ).rows[0]?.pid;
          if (pid === undefined)
            throw new Error("missing concurrent A backend PID");
          signalAReady();
          await holdA;
          const ids = await idsOnClient(clientA, "work_item");
          await clientA.query("COMMIT");
          return { pid, ids };
        } catch (error) {
          signalAFailed(error);
          throw error;
        }
      })();
      await aReady;

      let signalBBeginSubmitted: () => void = () => {};
      const bBeginSubmitted = new Promise<void>((resolve) => {
        signalBBeginSubmitted = resolve;
      });
      const bConcurrent = (async () => {
        const begin = clientB.query("BEGIN");
        signalBBeginSubmitted();
        await begin;
        const scope = await clientB.query<{ scope: string | null }>(
          "SELECT NULLIF(current_setting($1, true), '') AS scope",
          [GUC_NAME],
        );
        const unsetScope = normalizeScope(scope.rows[0]?.scope ?? null);
        await clientB.query("SELECT set_config($1, $2, true)", [
          GUC_NAME,
          organisationIds.customerB,
        ]);
        const pid = (
          await clientB.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
        ).rows[0]?.pid;
        if (pid === undefined)
          throw new Error("missing concurrent B backend PID");
        const ids = await idsOnClient(clientB, "work_item");
        await clientB.query("COMMIT");
        return { pid, unsetScope, ids };
      })();
      await bBeginSubmitted;

      const deadline = Date.now() + 5_000;
      let waitingPool:
        | {
            cl_waiting: string;
            sv_active: string;
          }
        | undefined;
      try {
        while (Date.now() < deadline) {
          const pools = await pgbouncerAdminPool.query<{
            database: string;
            user: string;
            cl_waiting: string;
            sv_active: string;
          }>("SHOW POOLS");
          waitingPool = pools.rows.find(
            (pool) =>
              pool.database === "probe" &&
              pool.user === PROBE_ROLE &&
              Number(pool.cl_waiting) === 1 &&
              Number(pool.sv_active) === 1,
          );
          if (waitingPool) break;
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        }
      } catch (error) {
        releaseA();
        await Promise.allSettled([aConcurrent, bConcurrent]);
        throw error;
      }
      releaseA();
      const [aResult, bResult] = await Promise.all([aConcurrent, bConcurrent]);
      expect(waitingPool).toBeDefined();
      expect(aResult.ids).toEqual(expectedIds.customerA.work_item);
      expect(bResult.unsetScope).toBe("UNSET");
      expect(bResult.ids).toEqual(expectedIds.customerB.work_item);
      expect(aResult.pid).toBe(aPid);
      expect(bResult.pid).toBe(aPid);

      const serverBackends = await ownerPool.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE datname = $1 AND usename = $2 ORDER BY pid",
        [databaseName, PROBE_ROLE],
      );
      expect(serverBackends.rows.map((row) => row.pid)).toEqual([aPid]);

      console.info(
        `RLS_PGBOUNCER_RESULTS ${JSON.stringify({
          postgresVersion,
          version,
          poolMode: config.get("pool_mode"),
          defaultPoolSize: config.get("default_pool_size"),
          databaseName,
          role: role.rows[0],
          reusedBackendPid: aPid,
          logicalClientsDistinct: clientA !== clientB,
          rows: {
            customerA: Object.fromEntries(
              Object.entries(expectedIds.customerA).map(([table, ids]) => [
                table,
                { count: ids.length, sha256: digestIds(ids) },
              ]),
            ),
            customerB: Object.fromEntries(
              Object.entries(expectedIds.customerB).map(([table, ids]) => [
                table,
                { count: ids.length, sha256: digestIds(ids) },
              ]),
            ),
          },
          committedScopeUnsetRows: 0,
          rolledBackScopeUnsetRows: 0,
          emptyScopeRows: 0,
          concurrentPoolState: waitingPool,
          concurrentClientBObservedScope: bResult.unsetScope,
          concurrentBackendPids: [aResult.pid, bResult.pid],
          backendCountAfterProbe: serverBackends.rows.length,
        })}`,
      );
    } finally {
      clientA.release();
      clientB.release();
    }
  }, 60_000);

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

    // Capture expected tenant IDs from the hand-written prototype predicates while RLS
    // is disabled. This is not an application-layer read path; compare it with the actual
    // route/controller reads only after that path has been exercised in the disposable DB.
    await setRlsEnabled(false);
    const applicationReadEvidence = await compareApplicationReadPaths();
    const expectedTenantBaseline = {
      work_item: await expectedTenantIdsFromPrototypePredicate(
        "work_item",
        organisationIds.customerA,
      ),
      comment: await expectedTenantIdsFromPrototypePredicate(
        "comment",
        organisationIds.customerA,
      ),
      attachment: await expectedTenantIdsFromPrototypePredicate(
        "attachment",
        organisationIds.customerA,
      ),
    };
    const expectedStaffProjectSet = await withTransaction(
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
      expectedTenantBaseline.work_item.sort(),
    );
    expect(rlsCustomerA.comment.sort()).toEqual(
      expectedTenantBaseline.comment.sort(),
    );
    expect(rlsCustomerA.attachment.sort()).toEqual(
      expectedTenantBaseline.attachment.sort(),
    );

    const rlsStaffReach = {
      work_item: await visibleIds("work_item", internalStaffScope),
      comment: await visibleIds("comment", internalStaffScope),
      attachment: await visibleIds("attachment", internalStaffScope),
    };
    const staffProjectExtra = rlsStaffReach.work_item.filter(
      (id) => !expectedStaffProjectSet.includes(id),
    );
    expect(expectedStaffProjectSet.length).toBe(ROWS_PER_PROJECT * 3);
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
      expectedRowsForHandSelectedProjects: expectedStaffProjectSet.length,
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
      applicationReadPaths: applicationReadEvidence,
      timings: pairedTimings,
      measurementLimits: [
        "Single local Testcontainer, 1,202 work items total, one 40-sample warmed run per query/mode; not a production forecast.",
        "The custom GUC is settable by the database role. RLS is not an independent identity authority: the application must derive and bind the scope from trusted authorization state, and the runtime role must not bypass row security.",
        "Hot-read timings use direct SQL shaped from the current work-item list, comment activity, and attachment controllers. Separate boundary checks invoke the actual Hono read routes, but no application GUC wrapper is installed.",
        "RLS was disabled/enabled on the same migrated tables and data; no production migration or schema was modified.",
      ],
    };
    console.info(`RLS_PROTOTYPE_RESULTS ${JSON.stringify(report)}`);

    expect(rlsStaffReach.work_item).toHaveLength(ROWS_PER_PROJECT * 4);
    expect(rlsStaffReach.comment).toHaveLength(ROWS_PER_PROJECT * 4);
    expect(rlsStaffReach.attachment).toHaveLength(ROWS_PER_PROJECT * 4 + 2);
    expect(
      rlsStaffReach.work_item.some((id) =>
        expectedStaffProjectSet.includes(id),
      ),
    ).toBe(true);
  }, 180_000);
});
