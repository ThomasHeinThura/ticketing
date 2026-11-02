import { createHash } from "node:crypto";
import { resolveFeatureFlag } from "@taskdesk/permissions";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import db, { schema } from "../database";
import {
  customerPortalOnSql,
  customerPortalScope,
  projectsWithFeatureEnabled,
} from "../feature-flag/enforce";
import { csvRow } from "../report/logic";
import { PORTAL_PRIORITIES } from "./portal-priority";
import { loadPortalSla, type PortalSla } from "./portal-sla";
import {
  PORTAL_CUSTOMER_STATUSES,
  type PortalCustomerStatus,
} from "./portal-status";
import { loadPortalViewer, type PortalViewer } from "./repository";

/**
 * The customer's cases (S4b): one list over two sources, both read inside the caller's own
 * organisation only (`CP-1`, `CP-2`).
 *
 * 1. **Submissions** the caller may read (`CP-16`): their own, those they were added to as a
 *    participant, and organisation-visible colleague submissions. A colleague's converted request
 *    also needs its work item to be organisation-visible (the backlog's audience intersection),
 *    so "All" never shows a colleague's private item. As on the detail page, the work item's
 *    fields show only while it still belongs to the submission's requester.
 * 2. **Requests raised by staff for a customer** (D6, decided 31 Oct): a work item with no
 *    submission whose requester is a customer of the caller's organisation, in a live project of
 *    that organisation. The caller sees it as the requester, as a participant, or when it is
 *    organisation-visible.
 *
 * Never selected: the assignee, the claimer, any comment, any internal field (`CP-3`, `CP-4`).
 * Customer status is derived in SQL by {@link customerStatusSql}, the same rules as
 * `portalCustomerStatus`, so filters, paging, counts and the CSV agree with each other.
 */

export const PORTAL_CASE_PAGE_DEFAULT = 25;
export const PORTAL_CASE_PAGE_MAX = 100;
/** The most rows one CSV export carries; the response says when it was cut short. */
export const PORTAL_CASE_EXPORT_CAP = 5000;
const EXPORT_PAGE = 500;
const MAX_CURSOR_LENGTH = 2048;

export const PORTAL_CASE_SORTS = [
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
] as const;
export type PortalCaseSort = (typeof PORTAL_CASE_SORTS)[number];

const OPEN_STATUSES = ["received", "need_more_info", "in_progress"] as const;
const CLOSED_STATUSES = ["resolved", "closed", "declined"] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Invalid date",
  });

function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .max(200)
    .transform((raw, context) => {
      const parts = [
        ...new Set(
          raw
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      ];
      for (const part of parts)
        if (!(values as readonly string[]).includes(part)) {
          context.addIssue({
            code: "custom",
            message: `Unknown value ${part}`,
          });
          return z.NEVER;
        }
      return parts as T[number][];
    });
}

/** Filters shared by the list, the CSV export and (project only) the home counts. */
export const portalCaseFilterSchema = z.object({
  scope: z.enum(["mine", "all"]).optional(),
  status: csvEnum(PORTAL_CUSTOMER_STATUSES).optional(),
  priority: csvEnum(PORTAL_PRIORITIES).optional(),
  project: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(PORTAL_CASE_SORTS).optional(),
});

export const portalCaseListQuerySchema = portalCaseFilterSchema.extend({
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/u)
    .optional(),
});

export const portalHomeQuerySchema = z.object({
  project: portalCaseFilterSchema.shape.project,
});

export type PortalCaseFilters = z.infer<typeof portalCaseFilterSchema>;

const portalSlaSchema = z.object({
  state: z.enum(["on_track", "at_risk", "breached", "met", "missed"]),
  dueAt: z.string().datetime().nullable(),
  metric: z.enum(["first_response", "resolution"]),
});

export const portalCaseSchema = z.object({
  /** `SUB-n` for a submission; the request key for a request raised by staff (D6). */
  ref: z.string(),
  /** `submission` rows open their durable page; `direct` rows have no portal page yet. */
  source: z.enum(["submission", "direct"]),
  title: z.string(),
  requestTypeName: z.string(),
  priority: z.enum(PORTAL_PRIORITIES).nullable(),
  customerStatus: z.enum(PORTAL_CUSTOMER_STATUSES),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  project: z.object({ key: z.string(), name: z.string() }).nullable(),
  /** D5: a same-organisation customer's name; `isYou` marks the caller's own case. */
  createdBy: z.object({ name: z.string().nullable(), isYou: z.boolean() }),
  isRequester: z.boolean(),
  customerVisibility: z.enum(["private", "organisation"]),
  sla: portalSlaSchema.nullable(),
});
export type PortalCase = z.infer<typeof portalCaseSchema>;

export const portalCasePageSchema = z.object({
  cases: z.array(portalCaseSchema),
  page: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
  meta: z.object({ total: z.number().int() }),
});

export const portalHomeSchema = z.object({
  /**
   * Readable cases that need more information (a clarifying submission or an open
   * `waiting_customer` pause on its item), across the same readable set as the list's
   * `scope=all&status=need_more_info`, plus pending approvals addressed to the caller.
   */
  actionRequired: z.object({
    total: z.number().int(),
    cases: z.number().int(),
    approvals: z.number().int(),
  }),
  /** Received, need more information, or in progress, across the readable cases. */
  outstanding: z.number().int(),
  /** Resolved, closed or declined in the last 30 days. */
  closedLast30Days: z.number().int(),
  /**
   * D4: mean time to first response, in seconds, of requests first answered in the last 30
   * days, over projects with `feature.sla` on. Null when there is no such request.
   */
  averageFirstResponse: z
    .object({ seconds: z.number().int(), sampleSize: z.number().int() })
    .nullable(),
});
export type PortalHome = z.infer<typeof portalHomeSchema>;

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------

/**
 * `portalCustomerStatus` in SQL for a submission state (`null` for a request raised by staff,
 * which behaves like an accepted submission) and its work item columns.
 */
function customerStatusSql(submissionState: SQL): SQL {
  const workItemStatus = sql`CASE
    WHEN wi.id IS NULL THEN 'in_progress'
    WHEN stt."group" = 'cancelled' THEN 'closed'
    WHEN wi.resolved_at IS NOT NULL OR stt."group" = 'completed' THEN 'resolved'
    WHEN EXISTS (
      SELECT 1 FROM sla_pause sp
      WHERE sp.work_item_id = wi.id
        AND sp.reason = 'waiting_customer'
        AND sp.ended_at IS NULL
    ) THEN 'need_more_info'
    ELSE 'in_progress'
  END`;
  return sql`CASE
    WHEN ${submissionState} IS NULL THEN ${workItemStatus}
    WHEN ${submissionState} = 'new' THEN 'received'
    WHEN ${submissionState} = 'clarifying' THEN 'need_more_info'
    WHEN ${submissionState} = 'declined' THEN 'declined'
    WHEN ${submissionState} = 'withdrawn' THEN 'withdrawn'
    WHEN ${submissionState} IN ('accepted', 'duplicate') THEN ${workItemStatus}
    ELSE 'received'
  END`;
}

/** A form field mapped to `title` or `priority` on the pinned request-type version. */
function mappedFormValue(field: "title" | "priority"): SQL {
  return sql`btrim(s.form_data ->> (
    SELECT f ->> 'key'
    FROM jsonb_array_elements(COALESCE(rtv.form_schema -> 'fields', '[]'::jsonb)) f
    WHERE f -> 'mapsTo' ->> 'field' = ${field}
    LIMIT 1
  ))`;
}

function participantOf(column: SQL, viewer: PortalViewer): SQL {
  return sql`EXISTS (
    SELECT 1 FROM request_participant rp
    WHERE ${column} AND rp.person_id = ${viewer.personId}
  )`;
}

type CaseSourceContext = {
  viewer: PortalViewer;
  /** Workspaces where `feature.intake` is on; submissions elsewhere are not listed. */
  intakeWorkspaceIds: string[];
  portalScope: Awaited<ReturnType<typeof customerPortalScope>>;
};

/**
 * Every case the viewer may read, as one row shape. Columns: source, id, ref, title,
 * request_type_name, priority, customer_status, created_at, updated_at, closed_at, project_*,
 * requester_id, customer_visibility, work_item_id.
 */
function caseSourceSql(context: CaseSourceContext): SQL {
  const { viewer, intakeWorkspaceIds, portalScope } = context;
  const submissionOwnOrParticipant = sql`(
    s.requester_id = ${viewer.personId}
    OR ${participantOf(sql`rp.submission_id = s.id`, viewer)}
  )`;
  const submissionPortalOn = customerPortalOnSql(
    portalScope,
    sql`rt.workspace_id`,
    sql`(SELECT wi_p.project_id FROM work_item wi_p WHERE wi_p.id = s.work_item_id)`,
  );
  const workItemPortalOn = customerPortalOnSql(
    portalScope,
    sql`wi.workspace_id`,
    sql`wi.project_id`,
  );
  const submissions = intakeWorkspaceIds.length
    ? sql`
    SELECT
      'submission'::text AS source,
      s.id AS id,
      'SUB-' || s.number::text AS ref,
      COALESCE(NULLIF(wi.title, ''), NULLIF(${mappedFormValue("title")}, ''), '') AS title,
      rt.name AS request_type_name,
      CASE
        WHEN wi.id IS NOT NULL THEN wi.priority
        ELSE ${mappedFormValue("priority")}
      END AS priority,
      ${customerStatusSql(sql`s.state`)} AS customer_status,
      s.created_at AS created_at,
      GREATEST(s.updated_at, wi.updated_at AT TIME ZONE 'UTC') AS updated_at,
      CASE
        WHEN s.state = 'declined' THEN s.updated_at
        WHEN wi.resolved_at IS NOT NULL THEN wi.resolved_at AT TIME ZONE 'UTC'
        WHEN stt."group" IN ('completed', 'cancelled') THEN wi.updated_at AT TIME ZONE 'UTC'
        ELSE NULL
      END AS closed_at,
      p.id AS project_id,
      p.slug AS project_key,
      p.name AS project_name,
      s.requester_id AS requester_id,
      s.customer_visibility AS customer_visibility,
      wi.id AS work_item_id
    FROM submission s
    JOIN request_type rt ON rt.id = s.request_type_id
    JOIN request_type_version rtv ON rtv.id = s.request_type_version_id
    LEFT JOIN work_item wi
      ON wi.id = s.work_item_id
      AND wi.requester_id = s.requester_id
      AND wi.deleted_at IS NULL
    LEFT JOIN state st ON st.id = wi.state_id
    LEFT JOIN state_template stt ON stt.id = st.state_template_id
    LEFT JOIN project p
      ON p.id = COALESCE(wi.project_id, rt.default_project_id)
      AND p.organisation_id = ${viewer.organisationId}
      AND p.deleted_at IS NULL
    WHERE s.organisation_id = ${viewer.organisationId}
      AND (${submissionOwnOrParticipant} OR s.customer_visibility = 'organisation')
      AND (
        ${submissionOwnOrParticipant}
        OR wi.id IS NULL
        OR wi.customer_visibility = 'organisation'
        OR wi.requester_id = ${viewer.personId}
        OR ${participantOf(sql`rp.work_item_id = wi.id`, viewer)}
      )
      AND rt.workspace_id IN (${sql.join(
        intakeWorkspaceIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND ${submissionPortalOn}`
    : null;
  const direct = sql`
    SELECT
      'direct'::text AS source,
      wi.id AS id,
      wi.key AS ref,
      wi.title AS title,
      wit.name AS request_type_name,
      wi.priority AS priority,
      ${customerStatusSql(sql`NULL::text`)} AS customer_status,
      wi.created_at AT TIME ZONE 'UTC' AS created_at,
      wi.updated_at AT TIME ZONE 'UTC' AS updated_at,
      CASE
        WHEN wi.resolved_at IS NOT NULL THEN wi.resolved_at AT TIME ZONE 'UTC'
        WHEN stt."group" IN ('completed', 'cancelled') THEN wi.updated_at AT TIME ZONE 'UTC'
        ELSE NULL
      END AS closed_at,
      p.id AS project_id,
      p.slug AS project_key,
      p.name AS project_name,
      wi.requester_id AS requester_id,
      wi.customer_visibility AS customer_visibility,
      wi.id AS work_item_id
    FROM work_item wi
    JOIN project p
      ON p.id = wi.project_id
      AND p.organisation_id = ${viewer.organisationId}
      AND p.deleted_at IS NULL
      AND p.archived_at IS NULL
    JOIN person rq
      ON rq.id = wi.requester_id
      AND rq.organisation_id = ${viewer.organisationId}
      AND rq.side = 'customer'
    JOIN work_item_type wit ON wit.id = wi.type_id
    JOIN state st ON st.id = wi.state_id
    JOIN state_template stt ON stt.id = st.state_template_id
    WHERE wi.deleted_at IS NULL
      AND wi.archived_at IS NULL
      -- Skip only items the submission branch already shows (same requester); an item merged
      -- from a colleague's duplicate or reassigned to a new requester stays a direct row.
      AND NOT EXISTS (
        SELECT 1 FROM submission s2
        WHERE s2.work_item_id = wi.id AND s2.requester_id = wi.requester_id
      )
      AND (
        wi.requester_id = ${viewer.personId}
        OR wi.customer_visibility = 'organisation'
        OR ${participantOf(sql`rp.work_item_id = wi.id`, viewer)}
      )
      AND ${workItemPortalOn}`;
  return submissions ? sql`${submissions} UNION ALL ${direct}` : direct;
}

async function intakeWorkspaceIds(organisationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ workspaceId: schema.requestTypeTable.workspaceId })
    .from(schema.submissionTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
    )
    .where(eq(schema.submissionTable.organisationId, organisationId));
  const workspaceIds = rows.map((row) => row.workspaceId);
  if (workspaceIds.length === 0) return [];
  const [[instance], workspaceFlags] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    db
      .select({
        workspaceId: schema.workspaceFeatureFlagTable.workspaceId,
        enabled: schema.workspaceFeatureFlagTable.enabled,
      })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          inArray(schema.workspaceFeatureFlagTable.workspaceId, workspaceIds),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      ),
  ]);
  return workspaceIds.filter(
    (workspaceId) =>
      resolveFeatureFlag({
        feature: "feature.intake",
        instance: instance ?? null,
        workspace:
          workspaceFlags.find((flag) => flag.workspaceId === workspaceId)
            ?.enabled ?? null,
      }).enabled,
  );
}

async function caseSource(viewer: PortalViewer): Promise<SQL> {
  const [workspaceIds, portalScope] = await Promise.all([
    intakeWorkspaceIds(viewer.organisationId),
    customerPortalScope(),
  ]);
  return caseSourceSql({
    viewer,
    intakeWorkspaceIds: workspaceIds,
    portalScope,
  });
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function filterConditions(viewer: PortalViewer, filters: PortalCaseFilters) {
  const conditions: SQL[] = [];
  if (filters.scope === "mine")
    conditions.push(sql`c.requester_id = ${viewer.personId}`);
  if (filters.status?.length)
    conditions.push(
      sql`c.customer_status IN (${sql.join(
        filters.status.map((value) => sql`${value}`),
        sql`, `,
      )})`,
    );
  if (filters.priority?.length)
    conditions.push(
      sql`c.priority IN (${sql.join(
        filters.priority.map((value) => sql`${value}`),
        sql`, `,
      )})`,
    );
  if (filters.project) conditions.push(sql`c.project_key = ${filters.project}`);
  if (filters.from)
    conditions.push(
      sql`c.created_at >= ${new Date(`${filters.from}T00:00:00.000Z`).toISOString()}::timestamptz`,
    );
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(sql`c.created_at < ${end.toISOString()}::timestamptz`);
  }
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conditions.push(
      sql`(c.ref ILIKE ${pattern} OR c.title ILIKE ${pattern} OR c.request_type_name ILIKE ${pattern})`,
    );
  }
  return conditions;
}

function whereOf(conditions: SQL[]) {
  return conditions.length
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;
}

// ---------------------------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------------------------

type CaseCursor = { v: 1; scope: string; at: string; key: string };

function cursorScope(
  viewer: PortalViewer,
  filters: PortalCaseFilters,
  limit: number,
) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        filters.scope ?? "all",
        filters.status ?? [],
        filters.priority ?? [],
        filters.project ?? "",
        filters.from ?? "",
        filters.to ?? "",
        filters.q ?? "",
        filters.sort ?? "updated_desc",
        limit,
      ]),
    )
    .digest("base64url")
    .slice(0, 22);
  return `portal-cases:${viewer.personId}:${digest}`;
}

function decodeCursor(
  cursor: string | undefined,
  scope: string,
): CaseCursor | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as CaseCursor;
    if (
      decoded.v !== 1 ||
      decoded.scope !== scope ||
      typeof decoded.at !== "string" ||
      Number.isNaN(Date.parse(decoded.at)) ||
      typeof decoded.key !== "string" ||
      decoded.key.length > 200
    )
      throw new Error("invalid cursor");
    return decoded;
  } catch {
    throw new HTTPException(400, { message: "Invalid case cursor" });
  }
}

function encodeCursor(cursor: CaseCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

type CaseRow = {
  source: "submission" | "direct";
  id: string;
  ref: string;
  title: string | null;
  request_type_name: string;
  priority: string | null;
  customer_status: string;
  created_at: Date | string;
  updated_at: Date | string;
  sort_at: Date | string;
  case_key: string;
  project_key: string | null;
  project_name: string | null;
  requester_id: string | null;
  customer_visibility: string;
  work_item_id: string | null;
  created_by_name: string | null;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function selectCases(
  viewer: PortalViewer,
  filters: PortalCaseFilters,
  options: { limit: number; after?: CaseCursor },
): Promise<CaseRow[]> {
  const sort = filters.sort ?? "updated_desc";
  const column = sort.startsWith("created")
    ? sql`c.created_at`
    : sql`c.updated_at`;
  const descending = sort.endsWith("_desc");
  const sortAt = sql`date_trunc('milliseconds', ${column})`;
  const conditions = filterConditions(viewer, filters);
  if (options.after) {
    const at = sql`${options.after.at}::timestamptz`;
    conditions.push(
      descending
        ? sql`(${sortAt} < ${at} OR (${sortAt} = ${at} AND c.source || ':' || c.id < ${options.after.key}))`
        : sql`(${sortAt} > ${at} OR (${sortAt} = ${at} AND c.source || ':' || c.id > ${options.after.key}))`,
    );
  }
  const direction = descending ? sql`DESC` : sql`ASC`;
  const source = await caseSource(viewer);
  const result = await db.execute<CaseRow>(sql`
    WITH cases AS (${source})
    SELECT
      c.source, c.id, c.ref, c.title, c.request_type_name, c.priority, c.customer_status,
      c.created_at, c.updated_at, ${sortAt} AS sort_at, c.source || ':' || c.id AS case_key,
      c.project_key, c.project_name, c.requester_id, c.customer_visibility, c.work_item_id,
      CASE
        WHEN cb.side = 'customer' AND cb.organisation_id = ${viewer.organisationId}
          THEN COALESCE(NULLIF(btrim(cb.display_name), ''), NULLIF(btrim(cbu.name), ''))
        ELSE NULL
      END AS created_by_name
    FROM cases c
    LEFT JOIN person cb ON cb.id = c.requester_id
    LEFT JOIN "user" cbu ON cbu.id = cb.user_id
    ${whereOf(conditions)}
    ORDER BY ${sortAt} ${direction}, case_key ${direction}
    LIMIT ${options.limit}
  `);
  return result.rows;
}

async function countCases(
  viewer: PortalViewer,
  filters: PortalCaseFilters,
): Promise<number> {
  const source = await caseSource(viewer);
  const result = await db.execute<{ total: number | string }>(sql`
    WITH cases AS (${source})
    SELECT count(*)::int AS total FROM cases c
    ${whereOf(filterConditions(viewer, filters))}
  `);
  return Number(result.rows[0]?.total ?? 0);
}

function narrowPriority(value: string | null): PortalCase["priority"] {
  return (PORTAL_PRIORITIES as readonly string[]).includes(value ?? "")
    ? (value as PortalCase["priority"])
    : null;
}

function narrowStatus(value: string): PortalCustomerStatus {
  return (PORTAL_CUSTOMER_STATUSES as readonly string[]).includes(value)
    ? (value as PortalCustomerStatus)
    : "received";
}

async function toCases(
  viewer: PortalViewer,
  rows: CaseRow[],
  withSla: boolean,
): Promise<PortalCase[]> {
  const slas = new Map<string, PortalSla | null>();
  if (withSla) {
    const withItem = rows.filter((row) => row.work_item_id && row.requester_id);
    for (let index = 0; index < withItem.length; index += 10)
      await Promise.all(
        withItem.slice(index, index + 10).map(async (row) => {
          slas.set(
            row.case_key,
            await loadPortalSla(
              row.work_item_id as string,
              row.requester_id as string,
            ),
          );
        }),
      );
  }
  return rows.map((row) => {
    const isYou = row.requester_id === viewer.personId;
    return {
      ref: row.ref,
      source: row.source,
      title: row.title ?? "",
      requestTypeName: row.request_type_name,
      priority: narrowPriority(row.priority),
      customerStatus: narrowStatus(row.customer_status),
      createdAt: toDate(row.created_at).toISOString(),
      updatedAt: toDate(row.updated_at).toISOString(),
      project:
        row.project_key && row.project_name
          ? { key: row.project_key, name: row.project_name }
          : null,
      createdBy: { name: isYou ? null : row.created_by_name, isYou },
      isRequester: isYou,
      customerVisibility:
        row.customer_visibility === "organisation" ? "organisation" : "private",
      sla: slas.get(row.case_key) ?? null,
    };
  });
}

export async function listPortalCases(
  personId: string,
  query: z.infer<typeof portalCaseListQuerySchema>,
) {
  const viewer = await loadPortalViewer(personId);
  const { cursor, limit: rawLimit, ...filters } = query;
  const limit = Math.min(
    Math.max(Number(rawLimit ?? PORTAL_CASE_PAGE_DEFAULT) || 1, 1),
    PORTAL_CASE_PAGE_MAX,
  );
  const scope = cursorScope(viewer, filters, limit);
  const after = decodeCursor(cursor, scope);
  const [rows, total] = await Promise.all([
    selectCases(viewer, filters, {
      limit: limit + 1,
      ...(after ? { after } : {}),
    }),
    countCases(viewer, filters),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    cases: await toCases(viewer, pageRows, true),
    page: {
      nextCursor:
        hasMore && last
          ? encodeCursor({
              v: 1,
              scope,
              at: toDate(last.sort_at).toISOString(),
              key: last.case_key,
            })
          : null,
      hasMore,
    },
    meta: { total },
  };
}

// ---------------------------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------------------------

const STATUS_LABEL: Record<PortalCustomerStatus, string> = {
  received: "Received",
  need_more_info: "Need more information",
  in_progress: "In progress",
  resolved: "Resolved",
  declined: "Declined",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

export const PORTAL_CASE_CSV_HEADER = [
  "Reference",
  "Title",
  "Request type",
  "Severity",
  "Status",
  "Project",
  "Created by",
  "Created",
  "Updated",
];

function csvLine(item: PortalCase): string {
  return csvRow([
    item.ref,
    item.title,
    item.requestTypeName,
    item.priority,
    STATUS_LABEL[item.customerStatus],
    item.project ? `${item.project.name} (${item.project.key})` : null,
    item.createdBy.isYou ? "You" : item.createdBy.name,
    item.createdAt,
    item.updatedAt,
  ]);
}

/**
 * The same rows as the list, in the list's order, as RFC 4180 CSV with formula-leading cells
 * neutralised (`csvCell`). At most {@link PORTAL_CASE_EXPORT_CAP} rows; `truncated` reports a cut.
 */
export async function exportPortalCases(
  personId: string,
  filters: PortalCaseFilters,
) {
  const viewer = await loadPortalViewer(personId);
  const total = await countCases(viewer, filters);
  const truncated = total > PORTAL_CASE_EXPORT_CAP;
  const encoder = new TextEncoder();
  let written = 0;
  let after: CaseCursor | undefined;
  let headerSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(
            encoder.encode(`${csvRow(PORTAL_CASE_CSV_HEADER)}\r\n`),
          );
        }
        const remaining = PORTAL_CASE_EXPORT_CAP - written;
        if (remaining <= 0) {
          controller.close();
          return;
        }
        const rows = await selectCases(viewer, filters, {
          limit: Math.min(EXPORT_PAGE, remaining),
          ...(after ? { after } : {}),
        });
        if (rows.length === 0) {
          controller.close();
          return;
        }
        const last = rows.at(-1) as CaseRow;
        after = {
          v: 1,
          scope: "export",
          at: toDate(last.sort_at).toISOString(),
          key: last.case_key,
        };
        written += rows.length;
        const items = await toCases(viewer, rows, false);
        controller.enqueue(
          encoder.encode(items.map((item) => `${csvLine(item)}\r\n`).join("")),
        );
        if (rows.length < EXPORT_PAGE) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return { stream, truncated, total };
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------

export async function portalHomeCounts(
  personId: string,
  project: string | undefined,
): Promise<Omit<PortalHome, "actionRequired"> & { needMoreInfo: number }> {
  const viewer = await loadPortalViewer(personId);
  const source = await caseSource(viewer);
  const projectFilter = project ? sql`AND c.project_key = ${project}` : sql``;
  const open = sql.join(
    OPEN_STATUSES.map((value) => sql`${value}`),
    sql`, `,
  );
  const closed = sql.join(
    CLOSED_STATUSES.map((value) => sql`${value}`),
    sql`, `,
  );
  const [counts, response] = await Promise.all([
    db.execute<{
      outstanding: number;
      need_more_info: number;
      closed_recent: number;
    }>(sql`
      WITH cases AS (${source})
      SELECT
        count(*) FILTER (WHERE c.customer_status IN (${open}))::int AS outstanding,
        -- Every readable case waiting on the customer: the same rows as the list's
        -- scope=all&status=need_more_info.
        count(*) FILTER (WHERE c.customer_status = 'need_more_info')::int AS need_more_info,
        count(*) FILTER (
          WHERE c.customer_status IN (${closed})
            AND c.closed_at >= now() - interval '30 days'
        )::int AS closed_recent
      FROM cases c
      WHERE true ${projectFilter}
    `),
    // D4: per project, so `feature.sla` can be applied per project below. Work item columns are
    // UTC timestamps without a zone, compared with the UTC wall clock.
    db.execute<{ project_id: string; samples: number; seconds: string }>(sql`
      WITH cases AS (${source})
      SELECT
        wi.project_id AS project_id,
        count(*)::int AS samples,
        sum(EXTRACT(EPOCH FROM (wi.first_response_at - COALESCE(wi.sla_started_at, wi.created_at))))::text AS seconds
      FROM work_item wi
      WHERE wi.id IN (
          SELECT c.work_item_id FROM cases c
          WHERE c.work_item_id IS NOT NULL ${projectFilter}
        )
        AND wi.first_response_at IS NOT NULL
        AND wi.first_response_at >= (now() AT TIME ZONE 'UTC') - interval '30 days'
        AND wi.first_response_at >= COALESCE(wi.sla_started_at, wi.created_at)
      GROUP BY wi.project_id
    `),
  ]);
  const row = counts.rows[0];
  const projectIds = response.rows.map((entry) => entry.project_id);
  const slaOn = projectIds.length
    ? await projectsWithFeatureEnabled("feature.sla", projectIds)
    : new Set<string>();
  let samples = 0;
  let seconds = 0;
  for (const entry of response.rows)
    if (slaOn.has(entry.project_id)) {
      samples += Number(entry.samples);
      seconds += Number(entry.seconds);
    }
  return {
    outstanding: Number(row?.outstanding ?? 0),
    needMoreInfo: Number(row?.need_more_info ?? 0),
    closedLast30Days: Number(row?.closed_recent ?? 0),
    averageFirstResponse:
      samples > 0
        ? { seconds: Math.round(seconds / samples), sampleSize: samples }
        : null,
  };
}

/** The ids of the viewer organisation's live projects with this key (`?project=`). */
export async function organisationProjectIds(
  organisationId: string,
  key: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.organisationId, organisationId),
        eq(schema.projectTable.slug, key),
        sql`${schema.projectTable.deletedAt} IS NULL`,
      ),
    );
  return new Set(rows.map((row) => row.id));
}

// ---------------------------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------------------------

export const portalMeSchema = z.object({
  name: z.string().nullable(),
  email: z.string(),
  image: z.string().nullable(),
  jobTitle: z.string().nullable(),
  organisation: z.object({ name: z.string() }),
});

export async function portalMe(personId: string) {
  const [row] = await db
    .select({
      displayName: schema.personTable.displayName,
      jobTitle: schema.personTable.jobTitle,
      userName: schema.userTable.name,
      email: schema.userTable.email,
      image: schema.userTable.image,
      organisationName: schema.organisationTable.name,
    })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.userTable.id, schema.personTable.userId),
    )
    .innerJoin(
      schema.organisationTable,
      eq(schema.organisationTable.id, schema.personTable.organisationId),
    )
    .where(
      and(
        eq(schema.personTable.id, personId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!row)
    throw new HTTPException(404, { message: "Portal account not found" });
  return {
    name: row.displayName?.trim() || row.userName?.trim() || null,
    email: row.email,
    image: row.image ?? null,
    jobTitle: row.jobTitle?.trim() || null,
    organisation: { name: row.organisationName },
  };
}
