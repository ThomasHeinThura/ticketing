import { createHash } from "node:crypto";
import { can } from "@taskdesk/permissions";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { resolveIdentity } from "../../permissions/resolve-identity";
import { evaluateProjectRead } from "../../utils/has-project-reach";
import { workItemPolicies } from "../policy";
import type { SearchFilter, WorkItemSearchQuery } from "./query";

const priorityRank = sql<number>`case ${schema.workItemTable.priority} when 'low' then 1 when 'medium' then 2 when 'high' then 3 when 'urgent' then 4 else null end`;
const sortExpr = (field: string): SQL =>
  field === "key"
    ? sql`${schema.workItemTable.key}`
    : field === "priority"
      ? priorityRank
      : field === "dueDate"
        ? sql`${schema.workItemTable.dueDate}`
        : sql`${schema.workItemTable.title}`;
const priorityRankValue = (v: string) =>
  ["low", "medium", "high", "urgent"].indexOf(v) + 1;

function filterSql(filter: SearchFilter, personId: string, now: Date): SQL {
  if ("clauses" in filter) {
    const children = filter.clauses.map((node) =>
      filterSql(node, personId, now),
    );
    return filter.op === "and" ? and(...children)! : or(...children)!;
  }
  const { field, op, value } = filter;
  const w = schema.workItemTable;
  if (field === "state.group") {
    const sub = db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(
        inArray(
          schema.stateTemplateTable.group,
          (op === "in" ? value : [value]) as string[],
        ),
      );
    return sql`${w.stateId} in (${sub})`;
  }
  if (field === "priority") {
    const vals = (op === "in" ? value : [value]) as string[];
    if (op === "eq" || op === "in") return inArray(w.priority, vals);
    const rank = priorityRankValue(value as string);
    return op === "gt"
      ? gt(priorityRank, rank)
      : op === "gte"
        ? gte(priorityRank, rank)
        : op === "lt"
          ? lt(priorityRank, rank)
          : lte(priorityRank, rank);
  }
  if (field === "assignee") return eq(w.assigneeId, personId);
  if (field === "watcher") {
    const sub = db
      .select({ id: schema.watcherTable.workItemId })
      .from(schema.watcherTable)
      .where(
        and(
          eq(schema.watcherTable.personId, personId),
          eq(schema.watcherTable.muted, false),
        ),
      );
    return sql`${w.id} in (${sub})`;
  }
  if (field === "dueDate" || field === "createdAt") {
    let date: Date;
    if (field === "dueDate" && typeof value === "string" && value.endsWith("d"))
      date = new Date(now.getTime() + Number.parseInt(value, 10) * 86_400_000);
    else date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    const column = field === "dueDate" ? w.dueDate : w.createdAt;
    const comparison =
      op === "lt"
        ? lt(column, date)
        : op === "lte"
          ? lte(column, date)
          : op === "gt"
            ? gt(column, date)
            : gte(column, date);
    return and(
      comparison,
      field === "dueDate" ? sql`${column} is not null` : undefined,
    )!;
  }
  if (field === "project") {
    const sub = db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.slug, value as string));
    return sql`${w.projectId} in (${sub})`;
  }
  if (field === "type") {
    const sub = db
      .select({ id: schema.workItemTypeTable.id })
      .from(schema.workItemTypeTable)
      .where(eq(schema.workItemTypeTable.key, value as string));
    return sql`${w.typeId} in (${sub})`;
  }
  throw new HTTPException(422, {
    message: `Filter field unavailable: ${field}`,
  });
}

type Cursor = {
  actor: string;
  workspace: string;
  hash: string;
  limit: number;
  field: string;
  order: string;
  value: string | number | null;
  isNull: boolean;
  id: string;
};
function decodeCursor(
  raw: string,
  expected: Omit<Cursor, "value" | "id" | "isNull">,
): Cursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Cursor;
    if (
      decoded.actor !== expected.actor ||
      decoded.workspace !== expected.workspace ||
      decoded.hash !== expected.hash ||
      decoded.limit !== expected.limit ||
      decoded.field !== expected.field ||
      decoded.order !== expected.order ||
      typeof decoded.id !== "string" ||
      decoded.id.length > 64 ||
      typeof decoded.isNull !== "boolean" ||
      !(
        typeof decoded.value === "string" ||
        typeof decoded.value === "number" ||
        decoded.value === null
      )
    )
      throw new Error();
    if (decoded.id.length === 0 || decoded.id.includes("\0")) throw new Error();
    if (
      decoded.isNull
        ? !(
            ["priority", "dueDate"].includes(expected.field) &&
            decoded.value === null
          )
        : decoded.value === null
    )
      throw new Error();
    if (
      expected.field === "priority" &&
      decoded.value !== null &&
      (typeof decoded.value !== "number" ||
        !Number.isInteger(decoded.value) ||
        decoded.value < 1 ||
        decoded.value > 4)
    )
      throw new Error();
    if (
      (expected.field === "key" || expected.field === "title") &&
      (typeof decoded.value !== "string" ||
        decoded.value.length === 0 ||
        decoded.value.length > 500 ||
        decoded.value.includes("\0"))
    )
      throw new Error();
    if (
      expected.field === "dueDate" &&
      decoded.value !== null &&
      (typeof decoded.value !== "string" ||
        Number.isNaN(Date.parse(decoded.value)) ||
        new Date(decoded.value).toISOString() !== decoded.value)
    )
      throw new Error();
    return decoded;
  } catch {
    throw new HTTPException(400, {
      message: "cursor: malformed or does not match this search",
    });
  }
}

export async function searchWorkItems(input: {
  userId: string;
  apiKey?: { enabled?: boolean; userId?: string };
  impersonatedBy?: string | null;
  workspaceId: string;
  query: WorkItemSearchQuery;
  limit: number;
  cursor?: string;
}) {
  const { userId, workspaceId, query, limit } = input;
  const identity = await resolveIdentity({
    userId,
    credential: input.apiKey
      ? "api_key"
      : input.impersonatedBy
        ? "impersonation"
        : "session",
    ...(input.apiKey
      ? {
          apiKey: {
            enabled: input.apiKey.enabled === true,
            ownerUserId: input.apiKey.userId ?? "",
          },
        }
      : {}),
  });
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!identity || !person)
    throw new HTTPException(403, {
      message: "Missing work_item:read permission",
    });
  const projectRows = await db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.projectTable.organisationId,
      deletedAt: schema.projectTable.deletedAt,
      archivedAt: schema.projectTable.archivedAt,
    })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.workspaceId, workspaceId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    );
  const searchPolicy = workItemPolicies["POST /api/work-items/search"];
  const projectIds = projectRows
    .filter((p) => {
      const decision = evaluateProjectRead(
        identity,
        searchPolicy.capability,
        searchPolicy.scope,
        {
          projectId: p.id,
          workspaceId: p.workspaceId,
          organisationId: p.organisationId,
          ancestorProjectIds: [],
          ownerTeamId: null,
        },
      );
      return decision?.reachable && decision.capable;
    })
    .map((p) => p.id);
  const fields = new Set<string>();
  const collect = (node?: SearchFilter) => {
    if (!node) return;
    if ("clauses" in node)
      node.clauses.forEach((child) => {
        collect(child);
      });
    else fields.add(node.field);
  };
  collect(query.filter);
  if (
    fields.has("project") &&
    (projectIds.length === 0 ||
      !projectRows
        .filter((p) => projectIds.includes(p.id))
        .every((p) =>
          can(identity, "project:read", "project", {
            projectId: p.id,
            workspaceId,
          }),
        ))
  )
    throw new HTTPException(422, {
      message: "Filter field unavailable: project",
    });
  if (
    fields.has("type") &&
    !can(identity, "workspace:read", "workspace", { workspaceId })
  )
    throw new HTTPException(422, { message: "Filter field unavailable: type" });
  const hash = createHash("sha256").update(JSON.stringify(query)).digest("hex");
  const field = query.sort?.[0]?.field ?? "key";
  const order = query.sort?.[0]?.order ?? "asc";
  const cursorExpected = {
    actor: userId,
    workspace: workspaceId,
    hash,
    limit,
    field,
    order,
  };
  const decoded = input.cursor
    ? decodeCursor(input.cursor, cursorExpected)
    : undefined;
  const w = schema.workItemTable;
  const p = schema.projectTable;
  const s = schema.stateTable;
  const st = schema.stateTemplateTable;
  const personTable = schema.personTable;
  const conditions: SQL[] = [
    eq(w.workspaceId, workspaceId),
    isNull(w.deletedAt),
    isNull(w.archivedAt),
    isNull(p.deletedAt),
    isNull(p.archivedAt),
    projectIds.length ? inArray(w.projectId, projectIds) : sql`false`,
  ];
  if (query.filter)
    conditions.push(filterSql(query.filter, person.id, new Date()));
  if (decoded) {
    const expr = sortExpr(field);
    const value = decoded.value;
    const cursorValue =
      field === "dueDate" && typeof value === "string"
        ? new Date(value)
        : value;
    let tieCondition: SQL;
    if (decoded.isNull)
      tieCondition = and(
        field === "priority" ? isNull(w.priority) : isNull(w.dueDate),
        gt(w.id, decoded.id),
      )!;
    else {
      const valueCondition =
        order === "asc"
          ? gt(expr, cursorValue as never)
          : lt(expr, cursorValue as never);
      tieCondition = or(
        valueCondition,
        and(eq(expr, cursorValue as never), gt(w.id, decoded.id)),
        field === "dueDate" || field === "priority"
          ? isNull(field === "dueDate" ? w.dueDate : w.priority)
          : undefined,
      )!;
    }
    conditions.push(tieCondition!);
  }
  const sortColumn = sortExpr(field);
  const orderExpr =
    field === "dueDate"
      ? [
          sql`case when ${w.dueDate} is null then 1 else 0 end asc`,
          order === "asc" ? asc(w.dueDate) : desc(w.dueDate),
          asc(w.id),
        ]
      : field === "priority"
        ? [
            sql`case when ${w.priority} is null then 1 else 0 end asc`,
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            asc(w.id),
          ]
        : [order === "asc" ? asc(sortColumn) : desc(sortColumn), asc(w.id)];
  const rowQuery = db
    .select({
      workItem: w,
      stateName: st.name,
      stateCategory: st.group,
      assigneeName: schema.userTable.name,
      assigneeWorkspaceMemberId: schema.workspaceUserTable.id,
    })
    .from(w)
    .innerJoin(p, eq(p.id, w.projectId))
    .innerJoin(s, eq(s.id, w.stateId))
    .innerJoin(st, eq(st.id, s.stateTemplateId))
    .leftJoin(personTable, eq(personTable.id, w.assigneeId))
    .leftJoin(schema.userTable, eq(schema.userTable.id, personTable.userId))
    .leftJoin(
      schema.workspaceUserTable,
      and(
        eq(schema.workspaceUserTable.userId, personTable.userId),
        eq(schema.workspaceUserTable.workspaceId, w.workspaceId),
      ),
    )
    .where(and(...conditions))
    .orderBy(...orderExpr)
    .limit(limit + 1);
  const baseConditions = decoded ? conditions.slice(0, -1) : conditions;
  const [rows, totals] = await Promise.all([
    rowQuery,
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(w)
      .innerJoin(p, eq(p.id, w.projectId))
      .innerJoin(s, eq(s.id, w.stateId))
      .innerJoin(st, eq(st.id, s.stateTemplateId))
      .where(and(...baseConditions)),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1)?.workItem;
  const value = last
    ? field === "key"
      ? last.key
      : field === "priority"
        ? last.priority === null
          ? null
          : priorityRankValue(last.priority)
        : field === "dueDate"
          ? (last.dueDate?.toISOString() ?? null)
          : last.title
    : null;
  const boundaryNull =
    !!last &&
    (field === "dueDate"
      ? last.dueDate === null
      : field === "priority"
        ? last.priority === null
        : false);
  const nextCursor =
    hasMore && last
      ? Buffer.from(
          JSON.stringify({
            ...cursorExpected,
            value,
            isNull: boundaryNull,
            id: last.id,
          }),
          "utf8",
        ).toString("base64url")
      : null;
  return {
    data: pageRows.map((row) => ({
      ...row.workItem,
      stateName: row.stateName,
      stateCategory: row.stateCategory,
      assigneeName: row.assigneeWorkspaceMemberId ? row.assigneeName : null,
    })),
    page: { nextCursor, hasMore },
    meta: { total: totals[0]?.total ?? 0 },
  };
}
