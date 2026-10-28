import { createHash } from "node:crypto";
import type { JsonValue } from "@taskdesk/domain";
import { can, type ResolvedIdentity } from "@taskdesk/permissions";
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
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import {
  listFields,
  type MaterializedField,
} from "../../custom-field/repository";
import db, { schema } from "../../database";
import {
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../../database/migration-schema";
import {
  type AuthenticatedApiKey,
  resolveRequestIdentity,
} from "../../permissions/resolve-request-identity";
import {
  loadAncestorIdsByProject,
  loadOwnerTeamIdsByProject,
} from "../../project/hierarchy.repository";
import type { CallerReachProjectFact } from "../../utils/caller-reach";
import { evaluateProjectRead } from "../../utils/has-project-reach";
import { decorateWorkItemRows } from "../decorate-rows";
import { workItemPolicies } from "../policy";
import {
  CUSTOM_FIELD_FILTER_KEY,
  type CustomFieldFilterDefinitions,
  customFieldClause,
  loadCustomFieldFilterDefinitions,
} from "./custom-field-filter";
import {
  customFieldSortProjectAuthority,
  projectCustomFieldColumns,
} from "./custom-field-projection";
import {
  hasWorkItemLifecycleFilter,
  type SearchFilter,
  type WorkItemSearchColumn,
  type WorkItemSearchQuery,
} from "./query";
import { isValidPositionSortCursorValue } from "./sort-cursor";

const priorityRank = sql<number>`case ${schema.workItemTable.priority} when 'low' then 1 when 'medium' then 2 when 'high' then 3 when 'urgent' then 4 else null end`;
const priorityRankValue = (v: string) =>
  ["low", "medium", "high", "urgent"].indexOf(v) + 1;

/** Preserve ordinary search unchanged; a supplied server ceiling only narrows it. */
export function intersectProjectScope(
  readableProjectIds: readonly string[],
  projectScopeIds?: readonly string[],
): string[] {
  if (projectScopeIds === undefined) return [...readableProjectIds];
  const scope = new Set(projectScopeIds);
  return readableProjectIds.filter((projectId) => scope.has(projectId));
}

type SortValue = string | number | boolean | null;
type LegacyListFilters = {
  state?: string;
  assignee?: string;
  cycle?: string;
  module?: string;
};
type SortPart = {
  expression: SQL;
  kind: "text" | "number" | "date" | "datetime" | "boolean";
  order: "asc" | "desc";
  field: string;
};

function requireSql(condition: SQL | undefined): SQL {
  if (condition) return condition;
  throw new HTTPException(422, { message: "Search condition unavailable" });
}

function emptyJsonValue(value: SQL): SQL {
  return sql`(
    ${value} IS NULL
    OR jsonb_typeof(${value}) = 'null'
    OR (jsonb_typeof(${value}) = 'string' AND btrim(${value} #>> '{}') = '')
    OR CASE
      WHEN jsonb_typeof(${value}) = 'array' THEN jsonb_array_length(${value}) = 0
      ELSE false
    END
  )`;
}

function customFieldValueExpression(fieldId: string, workspaceId: string): SQL {
  const w = schema.workItemTable;
  return sql`(
    SELECT cfv.value
    FROM ${customFieldValueTable} AS cfv
    WHERE cfv.workspace_id = ${workspaceId}
      AND cfv.custom_field_id = ${fieldId}
      AND cfv.entity_type = 'work_item'
      AND cfv.entity_id = ${w.id}
    LIMIT 1
  )`;
}

function conditionSql(
  condition: MaterializedField["visibilityCondition"],
  fieldsByKey: ReadonlyMap<string, MaterializedField>,
  workspaceId: string,
): SQL {
  if (!condition) return sql`true`;
  const controller = fieldsByKey.get(condition.field_key);
  if (!controller) return sql`false`;
  const actual = customFieldValueExpression(controller.id, workspaceId);
  if (condition.op === "is_set") return sql`NOT ${emptyJsonValue(actual)}`;
  if (condition.op === "eq" || condition.op === "neq") {
    const expected = JSON.stringify(condition.value);
    if (expected === undefined) return sql`false`;
    return condition.op === "eq"
      ? sql`${actual} IS NOT DISTINCT FROM ${expected}::jsonb`
      : sql`${actual} IS DISTINCT FROM ${expected}::jsonb`;
  }
  const allowed = JSON.stringify(condition.value);
  if (allowed === undefined) return sql`false`;
  return sql`(
    CASE
      WHEN jsonb_typeof(${actual}) = 'array' THEN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${actual}) AS controller_value(value)
        WHERE ${allowed}::jsonb @> jsonb_build_array(controller_value.value)
      )
      ELSE ${actual} IS NOT NULL
        AND ${allowed}::jsonb @> jsonb_build_array(${actual})
    END
  )`;
}

function customFieldSortParts({
  field,
  order,
  fieldsByKey,
  workspaceId,
  authorities,
  personId,
}: {
  field: MaterializedField;
  order: "asc" | "desc";
  fieldsByKey: ReadonlyMap<string, MaterializedField>;
  workspaceId: string;
  authorities: Awaited<ReturnType<typeof customFieldSortProjectAuthority>>;
  personId: string;
}): SortPart[] {
  const w = schema.workItemTable;
  const value = customFieldValueExpression(field.id, workspaceId);
  const shown = sql`(
    EXISTS (
      SELECT 1
      FROM ${customFieldTypeVisibilityTable} AS cf_visibility
      WHERE cf_visibility.workspace_id = ${workspaceId}
        AND cf_visibility.custom_field_id = ${field.id}
        AND cf_visibility.work_item_type_id = ${w.typeId}
        AND cf_visibility.visible = true
    )
    AND ${conditionSql(field.visibilityCondition, fieldsByKey, workspaceId)}
  )`;
  const safeValue = sql`(
    CASE
      WHEN ${shown} AND NOT ${emptyJsonValue(value)} THEN ${value}
      ELSE NULL
    END
  )`;
  const base = `cf.${field.key}`;
  switch (field.format) {
    case "number":
    case "decimal":
      return [
        {
          expression: sql`CASE WHEN jsonb_typeof(${safeValue}) = 'number' THEN (${safeValue} #>> '{}')::numeric ELSE NULL END`,
          kind: "number",
          order,
          field: base,
        },
      ];
    case "currency":
      return [
        {
          expression: sql`(${safeValue} ->> 'currency') COLLATE "C"`,
          kind: "text",
          order,
          field: base,
        },
        {
          expression: sql`CASE WHEN jsonb_typeof(${safeValue} -> 'amount') = 'number' THEN (${safeValue} ->> 'amount')::numeric ELSE NULL END`,
          kind: "number",
          order,
          field: base,
        },
      ];
    case "date":
      return [
        {
          expression: sql`CASE WHEN jsonb_typeof(${safeValue}) = 'string' THEN (${safeValue} #>> '{}')::date ELSE NULL END`,
          kind: "date",
          order,
          field: base,
        },
      ];
    case "datetime":
      return [
        {
          expression: sql`CASE WHEN jsonb_typeof(${safeValue}) = 'string' THEN (${safeValue} #>> '{}')::timestamptz ELSE NULL END`,
          kind: "datetime",
          order,
          field: base,
        },
      ];
    case "boolean":
      return [
        {
          expression: sql`CASE WHEN ${safeValue} = 'false'::jsonb THEN 0 WHEN ${safeValue} = 'true'::jsonb THEN 1 ELSE NULL END`,
          kind: "boolean",
          order,
          field: base,
        },
      ];
    case "select": {
      const cases = field.options.map(
        (option) =>
          sql`WHEN ${safeValue} = ${JSON.stringify(option.key)}::jsonb THEN ${option.label}`,
      );
      const labelExpression = cases.length
        ? sql`CASE ${sql.join(cases, sql` `)} ELSE NULL END`
        : sql`NULL`;
      return [
        {
          expression: sql`${labelExpression} COLLATE "C"`,
          kind: "text",
          order,
          field: base,
        },
      ];
    }
    case "multi_select": {
      const arrayValue = sql`CASE WHEN jsonb_typeof(${safeValue}) = 'array' THEN ${safeValue} ELSE '[]'::jsonb END`;
      return [
        {
          expression: sql`(
            SELECT string_agg(length(COALESCE(option.value ->> 'label', choice.value #>> '{}'))::text || ':' || COALESCE(option.value ->> 'label', choice.value #>> '{}'), '' ORDER BY choice.ordinality) COLLATE "C"
            FROM jsonb_array_elements(${arrayValue}) WITH ORDINALITY AS choice(value, ordinality)
            LEFT JOIN LATERAL jsonb_array_elements(${JSON.stringify(field.options)}::jsonb) AS option(value)
              ON option.value ->> 'key' = choice.value #>> '{}'
          )`,
          kind: "text",
          order,
          field: base,
        },
      ];
    }
    case "text":
    case "long_text":
    case "url":
    case "email":
      return [
        {
          expression: sql`NULLIF(btrim(${safeValue} #>> '{}'), '') COLLATE "C"`,
          kind: "text",
          order,
          field: base,
        },
      ];
    case "user":
    case "multi_user": {
      const membership = alias(
        schema.membershipTable,
        "custom_sort_membership",
      );
      const person = alias(schema.personTable, "custom_sort_person");
      const user = alias(schema.userTable, "custom_sort_user");
      const scopeTerms = authorities.flatMap((authority) => {
        const scope = inArray(membership.scopeId, authority.rosterProjectIds);
        const assignable = and(eq(w.projectId, authority.projectId), scope);
        const own = and(
          eq(w.projectId, authority.projectId),
          eq(person.id, personId),
          scope,
        );
        return [
          ...(authority.canViewAssignableNames && assignable
            ? [assignable]
            : []),
          ...(authority.canViewOwnName && own ? [own] : []),
        ];
      });
      const authorizedRoster =
        scopeTerms.length > 0
          ? sql`EXISTS (
              SELECT 1 FROM ${membership}
              WHERE ${membership.scope} = 'project'
                AND ${membership.personId} = ${person.id}
                AND ${or(...scopeTerms)}
            )`
          : sql`false`;
      const personPredicate = sql`
        ${person.side} = 'staff'
        AND ${person.active} = true
        AND ${person.isPlaceholder} = false
        AND ${user.name} IS NOT NULL
        AND ${authorizedRoster}
      `;
      if (field.format === "user")
        return [
          {
            expression: sql`(
              SELECT ${user.name} COLLATE "C"
              FROM ${schema.personTable} AS ${person}
              INNER JOIN ${schema.userTable} AS ${user}
                ON ${user.id} = ${person.userId}
              WHERE ${person.id} = (${safeValue} #>> '{}')
                AND ${personPredicate}
              LIMIT 1
            )`,
            kind: "text",
            order,
            field: base,
          },
        ];
      return [
        {
          expression: sql`(
            SELECT string_agg(length(${user.name})::text || ':' || ${user.name}, '' ORDER BY person_value.ordinality) COLLATE "C"
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${safeValue}) = 'array' THEN ${safeValue} ELSE '[]'::jsonb END) WITH ORDINALITY AS person_value(value, ordinality)
            INNER JOIN ${schema.personTable} AS ${person}
              ON ${person.id} = person_value.value #>> '{}'
            INNER JOIN ${schema.userTable} AS ${user}
              ON ${user.id} = ${person.userId}
            WHERE ${personPredicate}
          )`,
          kind: "text",
          order,
          field: base,
        },
      ];
    }
  }
}

function isValidSortCursorValue(
  part: SortPart | undefined,
  value: SortValue,
): boolean {
  if (!part) return false;
  if (value === null) return true;
  switch (part.kind) {
    case "text":
      return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 20_000 &&
        !value.includes("\0")
      );
    case "number":
      if (part.field === "position")
        return isValidPositionSortCursorValue(value);
      return (
        (part.field !== "priority" ||
          (typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 1 &&
            value <= 4)) &&
        ((typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" &&
            value.length <= 128 &&
            /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)))
      );
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
        return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(date.valueOf()) &&
        date.toISOString().slice(0, 10) === value
      );
    }
    case "datetime": {
      if (typeof value !== "string") return false;
      const date = new Date(value);
      const year = date.getUTCFullYear();
      return (
        !Number.isNaN(date.valueOf()) &&
        year >= 1900 &&
        year <= 9999 &&
        date.toISOString() === value
      );
    }
    case "boolean":
      return value === 0 || value === 1;
  }
}

function sqlSortCursorValue(part: SortPart, value: SortValue): unknown {
  if (value === null) return null;
  if (part.kind === "date" || part.kind === "datetime")
    return new Date(String(value));
  return value;
}

function serializeSortCursorValue(value: unknown): SortValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  throw new Error("Unexpected database sort value");
}

function nativeSortPart(field: string, order: "asc" | "desc"): SortPart {
  const w = schema.workItemTable;
  switch (field) {
    case "key":
      return {
        expression: sql`${w.key} COLLATE "C"`,
        kind: "text",
        order,
        field,
      };
    case "title":
      return {
        expression: sql`${w.title} COLLATE "C"`,
        kind: "text",
        order,
        field,
      };
    case "position":
      return {
        expression: sql`${w.position}`,
        kind: "number",
        order,
        field,
      };
    case "state":
      return {
        expression: sql`${schema.stateTemplateTable.name} COLLATE "C"`,
        kind: "text",
        order,
        field,
      };
    case "assignee":
      return {
        expression: sql`CASE WHEN ${schema.workspaceUserTable.id} IS NOT NULL THEN ${schema.userTable.name} ELSE NULL END COLLATE "C"`,
        kind: "text",
        order,
        field,
      };
    case "priority":
      return { expression: priorityRank, kind: "number", order, field };
    case "dueDate":
      return { expression: sql`${w.dueDate}`, kind: "datetime", order, field };
    default:
      throw new HTTPException(422, {
        message: `Sort field unavailable: ${field}`,
      });
  }
}

function filterSql(
  filter: SearchFilter,
  personId: string,
  now: Date,
  customFields: CustomFieldFilterDefinitions,
): SQL {
  if ("clauses" in filter) {
    const children = filter.clauses.map((node) =>
      filterSql(node, personId, now, customFields),
    );
    return requireSql(filter.op === "and" ? and(...children) : or(...children));
  }
  const { field, op, value } = filter;
  const w = schema.workItemTable;
  // CF-10: a custom-field value, matched through EXISTS over this workspace's field.
  if (CUSTOM_FIELD_FILTER_KEY.test(field))
    return customFieldClause(filter, customFields, personId);
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
  if (field === "requester") return eq(w.requesterId, personId);
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
    return field === "dueDate"
      ? requireSql(and(comparison, sql`${column} is not null`))
      : comparison;
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
  if (field === "lifecycle") {
    if (value === "active")
      return sql`${w.archivedAt} IS NULL AND ${w.deletedAt} IS NULL`;
    if (value === "archived")
      return sql`${w.archivedAt} IS NOT NULL AND ${w.deletedAt} IS NULL`;
    return sql`${w.deletedAt} IS NOT NULL`;
  }
  throw new HTTPException(422, {
    message: `Filter field unavailable: ${field}`,
  });
}

type CursorSort = { field: string; order: "asc" | "desc" };
type Cursor = {
  version: 2;
  actor: string;
  workspace: string;
  hash: string;
  limit: number;
  sorts: CursorSort[];
  values?: SortValue[];
  anchor?: true;
  tupleHash?: string;
  id: string;
};

type DecodedCursor = {
  actor: string;
  workspace: string;
  hash: string;
  limit: number;
  sorts: CursorSort[];
  values?: SortValue[];
  tupleHash?: string;
  id: string;
};

function hashSortTuple(
  parts: readonly SortPart[],
  values: readonly SortValue[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        parts: parts.map(({ field, kind, order }) => ({ field, kind, order })),
        values,
      }),
    )
    .digest("hex");
}

function decodeCursor(
  raw: string,
  expected: Omit<Cursor, "version" | "values" | "id"> & {
    valueCount: number;
  },
): DecodedCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const baseMatches =
      parsed.actor === expected.actor &&
      parsed.workspace === expected.workspace &&
      parsed.hash === expected.hash &&
      parsed.limit === expected.limit &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0 &&
      parsed.id.length <= 64 &&
      !parsed.id.includes("\0");
    if (!baseMatches) throw new Error();
    if (parsed.version === 2) {
      const isAnchor = parsed.anchor === true;
      if (
        JSON.stringify(parsed.sorts) !== JSON.stringify(expected.sorts) ||
        (isAnchor
          ? typeof parsed.tupleHash !== "string" ||
            !/^[a-f0-9]{64}$/.test(parsed.tupleHash) ||
            Object.hasOwn(parsed, "values")
          : !Array.isArray(parsed.values) ||
            parsed.values.length !== expected.valueCount ||
            parsed.values.some(
              (value) =>
                value !== null &&
                typeof value !== "string" &&
                typeof value !== "number" &&
                typeof value !== "boolean",
            ))
      )
        throw new Error();
      return {
        actor: parsed.actor as string,
        workspace: parsed.workspace as string,
        hash: parsed.hash as string,
        limit: parsed.limit as number,
        sorts: parsed.sorts as CursorSort[],
        ...(isAnchor
          ? { tupleHash: parsed.tupleHash as string }
          : { values: parsed.values as SortValue[] }),
        id: parsed.id as string,
      };
    }
    // Cursors issued before VW-20 contain one field and one value. Keep those usable only
    // when the current query still has precisely that one sort.
    const expectedLegacySort = expected.sorts[0];
    if (
      expected.sorts.length !== 1 ||
      expected.valueCount !== 1 ||
      !expectedLegacySort ||
      parsed.field !== expectedLegacySort.field ||
      parsed.order !== expectedLegacySort.order ||
      typeof parsed.isNull !== "boolean" ||
      !(
        parsed.value === null ||
        typeof parsed.value === "string" ||
        typeof parsed.value === "number"
      ) ||
      (parsed.isNull && parsed.value !== null) ||
      (!parsed.isNull && parsed.value === null)
    )
      throw new Error();
    return {
      actor: parsed.actor as string,
      workspace: parsed.workspace as string,
      hash: parsed.hash as string,
      limit: parsed.limit as number,
      sorts: expected.sorts,
      values: [parsed.value as SortValue],
      id: parsed.id as string,
    };
  } catch {
    throw new HTTPException(400, {
      message: "cursor: malformed or does not match this search",
    });
  }
}

export async function searchWorkItems(input: {
  userId: string;
  apiKey?: AuthenticatedApiKey;
  impersonatedBy?: string | null;
  workspaceId: string;
  query: WorkItemSearchQuery;
  limit: number;
  cursor?: string;
  /** A saved view's project context is an additional mandatory scope. */
  projectScopeId?: string;
  /**
   * Server-derived project ceiling for a combined-project board. This is never accepted
   * from the HTTP body; it narrows the already capability-filtered project set below.
   * An explicit empty list matches nothing. Omission preserves ordinary search exactly.
   */
  projectScopeIds?: readonly string[];
  /** Existing GET-list filters that have no equivalent in the public search grammar. */
  legacyListFilters?: LegacyListFilters;
  /** Counts use the same query/reach checks without loading a result page. */
  countOnly?: boolean;
}) {
  const { userId, workspaceId, query, limit } = input;
  const access = await resolveWorkItemSearchAccess(input);
  const { personId, projectIds, customFields, identity, sortProjects } = access;
  const effectiveProjectIds = intersectProjectScope(
    projectIds,
    input.projectScopeIds,
  );
  const effectiveProjectSet = new Set(effectiveProjectIds);
  const effectiveSortProjects = sortProjects.filter((project) =>
    effectiveProjectSet.has(project.projectId),
  );
  const scopedProjectIds = input.projectScopeIds
    ? [...new Set(input.projectScopeIds)].sort()
    : undefined;
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        query,
        projectScopeId: input.projectScopeId ?? null,
        ...(scopedProjectIds ? { projectScopeIds: scopedProjectIds } : {}),
        ...(input.legacyListFilters
          ? { legacyListFilters: input.legacyListFilters }
          : {}),
      }),
    )
    .digest("hex");
  const sortDescriptors: CursorSort[] = query.sort?.length
    ? query.sort
    : [{ field: "key", order: "asc" }];
  const requestedCustomSorts = sortDescriptors.filter((entry) =>
    entry.field.startsWith("cf."),
  );
  const sortFieldDefinitions = requestedCustomSorts.length
    ? await listFields(workspaceId)
    : [];
  const fieldsByKey = new Map(
    sortFieldDefinitions.map((field) => [field.key, field]),
  );
  for (const entry of requestedCustomSorts) {
    const key = entry.field.slice(3);
    if (!query.columns?.includes(entry.field as WorkItemSearchColumn))
      throw new HTTPException(422, {
        message: `Sort field unavailable: ${entry.field}`,
      });
    if (!fieldsByKey.has(key))
      throw new HTTPException(422, {
        message: `Sort field unavailable: ${entry.field}`,
      });
  }
  const customPeopleSorts = requestedCustomSorts.some((entry) => {
    const field = fieldsByKey.get(entry.field.slice(3));
    return field?.format === "user" || field?.format === "multi_user";
  });
  const personAuthorities = customPeopleSorts
    ? await customFieldSortProjectAuthority({
        identity,
        userId,
        apiKey: input.apiKey,
        workspaceId,
        projects: effectiveSortProjects,
      })
    : [];
  const sortParts = sortDescriptors.flatMap((entry) => {
    if (!entry.field.startsWith("cf."))
      return [nativeSortPart(entry.field, entry.order)];
    const field = fieldsByKey.get(entry.field.slice(3));
    if (!field)
      throw new HTTPException(422, {
        message: `Sort field unavailable: ${entry.field}`,
      });
    return customFieldSortParts({
      field,
      order: entry.order,
      fieldsByKey,
      workspaceId,
      authorities: personAuthorities,
      personId,
    });
  });
  if (sortParts.length === 0 || sortParts.length > 10)
    throw new HTTPException(422, { message: "Sort fields unavailable" });
  const cursorExpected = {
    actor: userId,
    workspace: workspaceId,
    hash,
    limit,
    sorts: sortDescriptors,
    valueCount: sortParts.length,
  };
  const decoded = input.cursor
    ? decodeCursor(input.cursor, cursorExpected)
    : undefined;
  if (
    decoded?.values?.some(
      (value, index) => !isValidSortCursorValue(sortParts[index], value),
    )
  )
    throw new HTTPException(400, {
      message: "cursor: malformed or does not match this search",
    });
  const w = schema.workItemTable;
  const p = schema.projectTable;
  const s = schema.stateTable;
  const st = schema.stateTemplateTable;
  const personTable = schema.personTable;
  const conditions: SQL[] = [
    eq(w.workspaceId, workspaceId),
    isNull(p.deletedAt),
    isNull(p.archivedAt),
    effectiveProjectIds.length
      ? inArray(w.projectId, effectiveProjectIds)
      : sql`false`,
  ];
  // Preserve the live-only default while allowing the explicit lifecycle leaf in a
  // saved/URL filter to select archived or deleted rows. This never changes the
  // mandatory workspace, project, or current-reach predicates below.
  if (!hasWorkItemLifecycleFilter(query.filter)) {
    conditions.push(isNull(w.deletedAt), isNull(w.archivedAt));
  }
  if (input.projectScopeId)
    conditions.push(eq(w.projectId, input.projectScopeId));
  if (query.filter)
    conditions.push(
      filterSql(query.filter, personId, new Date(), customFields),
    );
  const legacy = input.legacyListFilters;
  if (legacy?.state) {
    const stateIds = legacy.state.split(",").filter((id) => id.length > 0);
    if (stateIds.length > 0) conditions.push(inArray(w.stateId, stateIds));
  }
  if (legacy?.assignee) {
    if (legacy.assignee === "none") conditions.push(isNull(w.assigneeId));
    else if (legacy.assignee === "me")
      conditions.push(eq(w.assigneeId, personId));
    else conditions.push(eq(w.assigneeId, legacy.assignee));
  }
  if (legacy?.cycle) conditions.push(eq(w.cycleId, legacy.cycle));
  if (legacy?.module) conditions.push(eq(w.moduleId, legacy.module));
  const baseConditions = [...conditions];
  let decodedValues = decoded?.values;
  if (decoded?.tupleHash) {
    const anchorProjection = Object.fromEntries(
      sortParts.map((part, index) => [
        `cursorSort${index}`,
        sql`${part.expression}`.as(`cursor_sort_${index}`),
      ]),
    );
    const [anchor] = await db
      .select(anchorProjection)
      .from(w)
      .innerJoin(p, eq(p.id, w.projectId))
      .innerJoin(s, eq(s.id, w.stateId))
      .innerJoin(st, eq(st.id, s.stateTemplateId))
      .where(and(...baseConditions, eq(w.id, decoded.id)))
      .limit(1);
    if (!anchor) {
      throw new HTTPException(409, { message: "cursor_changed" });
    }
    decodedValues = sortParts.map((_, index) =>
      serializeSortCursorValue(
        (anchor as Record<string, unknown>)[`cursorSort${index}`],
      ),
    );
    if (hashSortTuple(sortParts, decodedValues) !== decoded.tupleHash) {
      throw new HTTPException(409, { message: "cursor_changed" });
    }
  }
  if (decoded) {
    const branches: SQL[] = [];
    const equalPrefix: SQL[] = [];
    for (let index = 0; index < sortParts.length; index++) {
      const part = sortParts[index];
      if (!part)
        throw new HTTPException(400, {
          message: "cursor: malformed or does not match this search",
        });
      const value = decodedValues?.[index];
      if (value === undefined)
        throw new HTTPException(400, {
          message: "cursor: malformed or does not match this search",
        });
      if (value !== null) {
        const cursorValue = sqlSortCursorValue(part, value);
        const comparison =
          part.order === "asc"
            ? sql`${part.expression} > ${cursorValue}`
            : sql`${part.expression} < ${cursorValue}`;
        branches.push(
          requireSql(
            and(
              ...equalPrefix,
              or(comparison, sql`${part.expression} IS NULL`),
            ),
          ),
        );
      }
      equalPrefix.push(
        value === null
          ? sql`${part.expression} IS NULL`
          : sql`${part.expression} IS NOT DISTINCT FROM ${sqlSortCursorValue(part, value)}`,
      );
    }
    branches.push(requireSql(and(...equalPrefix, gt(w.id, decoded.id))));
    conditions.push(requireSql(or(...branches)));
  }
  const totalQuery = db
    .select({ total: sql<number>`count(*)::int` })
    .from(w)
    .innerJoin(p, eq(p.id, w.projectId))
    .innerJoin(s, eq(s.id, w.stateId))
    .innerJoin(st, eq(st.id, s.stateTemplateId))
    .where(and(...baseConditions));
  if (input.countOnly) {
    const [totals] = await Promise.all([totalQuery]);
    return {
      data: [],
      page: { nextCursor: null, hasMore: false },
      meta: { total: totals[0]?.total ?? 0 },
    };
  }

  const orderExpr = sortParts.flatMap((part) => [
    sql`case when ${part.expression} is null then 1 else 0 end asc`,
    part.order === "asc" ? asc(part.expression) : desc(part.expression),
  ]);
  orderExpr.push(asc(w.id));
  const cursorSortProjection = Object.fromEntries(
    sortParts.map((part, index) => [
      `cursorSort${index}`,
      sql`${part.expression}`.as(`cursor_sort_${index}`),
    ]),
  );
  const rowQuery = db
    .select({
      workItem: w,
      stateName: st.name,
      stateCategory: st.group,
      assigneeName: schema.userTable.name,
      assigneeWorkspaceMemberId: schema.workspaceUserTable.id,
      ...cursorSortProjection,
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
  const [rows, totals] = await Promise.all([rowQuery, totalQuery]);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  // Same page-bounded catalogue projection as the unfiltered list. Never expose a
  // foreign/project/task-instance label through a malformed historical link.
  const assignedLabels = pageRows.length
    ? await db
        .select({
          workItemId: schema.workItemLabelTable.workItemId,
          id: schema.labelTable.id,
          name: schema.labelTable.name,
          color: schema.labelTable.color,
        })
        .from(schema.workItemLabelTable)
        .innerJoin(
          schema.labelTable,
          eq(schema.labelTable.id, schema.workItemLabelTable.labelId),
        )
        .innerJoin(w, eq(w.id, schema.workItemLabelTable.workItemId))
        .where(
          and(
            inArray(
              schema.workItemLabelTable.workItemId,
              pageRows.map((row) => row.workItem.id),
            ),
            eq(w.workspaceId, workspaceId),
            eq(schema.labelTable.workspaceId, workspaceId),
            isNull(schema.labelTable.taskId),
            or(
              isNull(schema.labelTable.projectId),
              eq(schema.labelTable.projectId, w.projectId),
            ),
          ),
        )
        .orderBy(schema.labelTable.name, schema.labelTable.id)
    : [];
  const labelsByItem = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >();
  for (const { workItemId, ...label } of assignedLabels) {
    const labels = labelsByItem.get(workItemId) ?? [];
    labels.push(label);
    labelsByItem.set(workItemId, labels);
  }
  // P1-7: the same row facts + SLA badge the unfiltered list attaches (shared helper).
  const decorate = await decorateWorkItemRows(
    db,
    pageRows,
    (row) => row.workItem,
  );
  type MaterializedSearchPageRow = Omit<
    (typeof pageRows)[number]["workItem"],
    "description"
  > & {
    description: JsonValue | null;
    labels: Array<{ id: string; name: string; color: string }>;
    stateName: (typeof pageRows)[number]["stateName"];
    stateCategory: (typeof pageRows)[number]["stateCategory"];
    assigneeName: (typeof pageRows)[number]["assigneeName"] | null;
    customFieldValues?: Record<string, unknown>;
  };
  const lastRow = pageRows.at(-1);
  const last = lastRow?.workItem;
  const cursorValues = lastRow
    ? sortParts.map((_, index) =>
        serializeSortCursorValue(
          (lastRow as Record<string, unknown>)[`cursorSort${index}`],
        ),
      )
    : [];
  let nextCursor: string | null = null;
  if (hasMore && last) {
    const cursorBase = {
      version: 2,
      actor: userId,
      workspace: workspaceId,
      hash,
      limit,
      sorts: sortDescriptors,
      id: last.id,
    };
    const fullCursor = Buffer.from(
      JSON.stringify({ ...cursorBase, values: cursorValues }),
      "utf8",
    ).toString("base64url");
    nextCursor =
      fullCursor.length <= 2048
        ? fullCursor
        : Buffer.from(
            JSON.stringify({
              ...cursorBase,
              anchor: true,
              tupleHash: hashSortTuple(sortParts, cursorValues),
            }),
            "utf8",
          ).toString("base64url");
  }
  const customFieldProjection = await projectCustomFieldColumns(
    access.identity,
    userId,
    input.apiKey,
    workspaceId,
    pageRows.map((row) => row.workItem),
    query.columns,
  );
  return {
    data: pageRows.map((row): MaterializedSearchPageRow => {
      const item: MaterializedSearchPageRow = {
        ...row.workItem,
        ...decorate(row),
        labels: labelsByItem.get(row.workItem.id) ?? [],
        description: row.workItem.description as JsonValue | null,
        stateName: row.stateName,
        stateCategory: row.stateCategory,
        assigneeName: row.assigneeWorkspaceMemberId ? row.assigneeName : null,
      };
      if (!customFieldProjection) return item;
      return {
        ...item,
        customFieldValues:
          customFieldProjection.valuesByItem.get(row.workItem.id) ?? {},
      };
    }),
    page: { nextCursor, hasMore },
    meta: { total: totals[0]?.total ?? 0 },
    ...(customFieldProjection
      ? { customFieldColumns: customFieldProjection.columns }
      : {}),
    ...(customFieldProjection?.people
      ? { customFieldPeople: customFieldProjection.people }
      : {}),
    // Internal-only handoff for the combined-board controller. Its public route strips
    // this field; ordinary search omits it entirely.
    ...(input.projectScopeIds !== undefined
      ? { serverScopedProjectIds: effectiveProjectIds }
      : {}),
  };
}

type WorkItemSearchAccessInput = {
  userId: string;
  apiKey?: AuthenticatedApiKey;
  impersonatedBy?: string | null;
  workspaceId: string;
  query: WorkItemSearchQuery;
  /** Server-derived scope for a combined board; never client input. */
  projectScopeIds?: readonly string[];
};

type ResolvedWorkItemSearchAccessInput = WorkItemSearchAccessInput & {
  identity: ResolvedIdentity;
  personId: string;
  /** Optional same-request reach facts supplied by the global-search route. */
  projectFacts?: readonly CallerReachProjectFact[];
};

type WorkItemSearchProject = {
  id: string;
  workspaceId: string;
  organisationId: string | null;
  deleted?: boolean;
  archived?: boolean;
  ancestorProjectIds?: readonly string[];
  ownerTeamId?: string | null;
};

async function resolveWorkItemSearchAccessForValidatedIdentity(
  input: ResolvedWorkItemSearchAccessInput,
) {
  const { userId, workspaceId, query, identity, personId } = input;
  if (
    identity.userId !== userId ||
    identity.personId !== personId ||
    personId.length === 0
  )
    throw new HTTPException(403, {
      message: "Missing work_item:read permission",
    });
  const scopedIds = input.projectScopeIds
    ? new Set(input.projectScopeIds)
    : undefined;
  const projectRows: WorkItemSearchProject[] = input.projectFacts
    ? input.projectFacts
        .filter(
          (project) =>
            project.workspaceId === workspaceId &&
            !project.deleted &&
            !project.archived &&
            (!scopedIds || scopedIds.has(project.id)),
        )
        .map((project) => ({ ...project }))
    : scopedIds?.size === 0
      ? []
      : await db
          .select({
            id: schema.projectTable.id,
            workspaceId: schema.projectTable.workspaceId,
            organisationId: schema.projectTable.organisationId,
          })
          .from(schema.projectTable)
          .where(
            and(
              eq(schema.projectTable.workspaceId, workspaceId),
              isNull(schema.projectTable.deletedAt),
              isNull(schema.projectTable.archivedAt),
              scopedIds
                ? inArray(schema.projectTable.id, [...scopedIds])
                : undefined,
            ),
          );
  const searchPolicy = workItemPolicies["POST /api/work-items/search"];
  // Reuse the immutable facts loaded by callerReach for global search. Other callers retain
  // this function's own live reads; neither path caches authority across requests.
  const ancestorsByProject = input.projectFacts
    ? undefined
    : await loadAncestorIdsByProject(db, [workspaceId]);
  const ownerTeams = input.projectFacts
    ? undefined
    : await loadOwnerTeamIdsByProject(db, [workspaceId]);
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
          ancestorProjectIds:
            p.ancestorProjectIds ?? ancestorsByProject?.get(p.id) ?? [],
          ownerTeamId: p.ownerTeamId ?? ownerTeams?.get(p.id) ?? null,
        },
      );
      return decision?.reachable && decision.capable;
    })
    .map((p) => p.id);
  const sortProjects = projectRows
    .filter((project) => projectIds.includes(project.id))
    .map((project) => ({
      projectId: project.id,
      ancestorProjectIds: [
        ...(project.ancestorProjectIds ??
          ancestorsByProject?.get(project.id) ??
          []),
      ],
      ownerTeamId: project.ownerTeamId ?? ownerTeams?.get(project.id) ?? null,
    }));
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
            ancestorProjectIds:
              p.ancestorProjectIds ?? ancestorsByProject?.get(p.id) ?? [],
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
  // CF-10: every `cf.<key>` must name a live field of THIS workspace, on every run of a
  // saved view too (a deleted field is a 422, never an unfiltered result).
  const customFields = await loadCustomFieldFilterDefinitions(
    workspaceId,
    query.filter,
    query.columns,
  );
  return {
    identity,
    personId,
    projectIds,
    sortProjects,
    customFields,
  };
}

/**
 * Reuses the already-validated, credential-bound identity from this request's reach context.
 * `resolveIdentity` only returns an identity with its active, unique person row present, so
 * this path avoids repeating that loader and its person lookup without caching authority across
 * requests. The structured search wrapper below still performs its usual fresh resolution.
 */
export async function resolveWorkItemSearchAccessForIdentity(
  input: WorkItemSearchAccessInput & {
    identity: ResolvedIdentity | null;
    projectFacts?: readonly CallerReachProjectFact[];
  },
) {
  const { identity, userId } = input;
  if (!identity || identity.userId !== userId || !identity.personId)
    throw new HTTPException(403, {
      message: "Missing work_item:read permission",
    });
  return resolveWorkItemSearchAccessForValidatedIdentity({
    userId,
    workspaceId: input.workspaceId,
    query: input.query,
    identity,
    personId: identity.personId,
    projectFacts: input.projectFacts,
  });
}

/** Re-evaluates search identity, project reach, and filter-field access. */
export async function resolveWorkItemSearchAccess(
  input: WorkItemSearchAccessInput,
) {
  const { userId } = input;
  const identity = await resolveRequestIdentity({
    userId,
    apiKey: input.apiKey,
    impersonatedBy: input.impersonatedBy,
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
  return resolveWorkItemSearchAccessForValidatedIdentity({
    ...input,
    identity,
    personId: person.id,
  });
}
