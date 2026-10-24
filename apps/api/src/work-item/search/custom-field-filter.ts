import { and, eq, exists, isNull, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  customFieldTable,
  customFieldValueTable,
} from "../../database/migration-schema";
import { workItemTable } from "../../database/schema";
import { escapeLikePattern } from "../../search/like-pattern";
import type { SearchFilter } from "./query";

/**
 * `CF-10`: `cf.<key>` filters in the saved-view / work-item search grammar.
 *
 * Shape (key pattern, operator set, value caps) is checked synchronously by
 * `validateWorkItemSearchQuery`; the field's existence and its format are workspace facts, so
 * they are resolved here, once per search, from the field definitions of the caller's workspace.
 * A key that names no live field is `422 Filter field unavailable: cf.<key>` (VW-31), never an
 * empty or unfiltered result, and the check runs again every time a saved view runs.
 *
 * Reach is untouched: the clause is one more AND condition over rows that are already limited to
 * the caller's reachable projects. A value is matched through `EXISTS` over `custom_field_value`
 * anchored on the work item AND its workspace, so a foreign workspace's field of the same key
 * never matches.
 */

export const CUSTOM_FIELD_FILTER_KEY = /^cf\.([A-Za-z0-9_-]{1,64})$/u;
export const CUSTOM_FIELD_FILTER_OPS = [
  "eq",
  "neq",
  "in",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_set",
] as const;

export type CustomFieldFilterDefinition = {
  id: string;
  key: string;
  format: string;
  options: readonly string[];
};
export type CustomFieldFilterDefinitions = ReadonlyMap<
  string,
  CustomFieldFilterDefinition
>;

/** The `cf.<key>` keys a filter tree references. */
export function customFieldFilterKeys(filter: SearchFilter | undefined) {
  const keys = new Set<string>();
  const walk = (node: SearchFilter | undefined) => {
    if (!node) return;
    if ("clauses" in node) {
      for (const child of node.clauses) walk(child);
      return;
    }
    const match = CUSTOM_FIELD_FILTER_KEY.exec(node.field);
    if (match?.[1]) keys.add(match[1]);
  };
  walk(filter);
  return keys;
}

/** Live field definitions for the referenced keys; an unknown or deleted key is a 422. */
export async function loadCustomFieldFilterDefinitions(
  workspaceId: string,
  filter: SearchFilter | undefined,
): Promise<CustomFieldFilterDefinitions> {
  const keys = customFieldFilterKeys(filter);
  const out = new Map<string, CustomFieldFilterDefinition>();
  if (keys.size === 0) return out;
  const rows = await db
    .select({
      id: customFieldTable.id,
      key: customFieldTable.key,
      format: customFieldTable.format,
      options: customFieldTable.options,
    })
    .from(customFieldTable)
    .where(
      and(
        eq(customFieldTable.workspaceId, workspaceId),
        isNull(customFieldTable.deletedAt),
      ),
    );
  for (const row of rows) {
    if (!keys.has(row.key)) continue;
    out.set(row.key, {
      id: row.id,
      key: row.key,
      format: row.format,
      options: (Array.isArray(row.options) ? row.options : [])
        .map((option) =>
          option && typeof option === "object"
            ? (option as { key?: unknown }).key
            : undefined,
        )
        .filter((key): key is string => typeof key === "string"),
    });
  }
  for (const key of keys)
    if (!out.has(key))
      throw new HTTPException(422, {
        message: `Filter field unavailable: cf.${key}`,
      });
  return out;
}

const OPS_BY_FORMAT: Record<string, readonly string[]> = {
  text: ["eq", "neq", "in", "contains", "is_set"],
  long_text: ["eq", "neq", "in", "contains", "is_set"],
  url: ["eq", "neq", "in", "contains", "is_set"],
  email: ["eq", "neq", "in", "contains", "is_set"],
  number: ["eq", "neq", "in", "gt", "gte", "lt", "lte", "is_set"],
  decimal: ["eq", "neq", "in", "gt", "gte", "lt", "lte", "is_set"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "is_set"],
  datetime: ["gt", "gte", "lt", "lte", "is_set"],
  boolean: ["eq", "is_set"],
  select: ["eq", "neq", "in", "is_set"],
  multi_select: ["contains", "in", "is_set"],
  user: ["eq", "is_set"],
  multi_user: ["contains", "is_set"],
  currency: ["is_set"],
};

function bad(message: string): never {
  throw new HTTPException(400, { message });
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

function scalar(value: unknown, field: string): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  return bad(`${field} expects a single value`);
}

function numberOf(value: unknown, field: string): number {
  const raw = scalar(value, field);
  const n = typeof raw === "number" ? raw : Number(raw);
  if (typeof raw === "boolean" || !Number.isFinite(n))
    return bad(`${field} expects a number`);
  return n;
}

function optionOf(
  def: CustomFieldFilterDefinition,
  value: unknown,
  field: string,
): string {
  const raw = scalar(value, field);
  if (typeof raw !== "string" || !def.options.includes(raw))
    return bad(`${field} names an unknown option`);
  return raw;
}

const v = customFieldValueTable;

/** `EXISTS` a value row of this field on the work item whose value satisfies `valueCondition`. */
function hasValue(def: CustomFieldFilterDefinition, valueCondition?: SQL): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(v)
      .where(
        and(
          eq(v.workspaceId, workItemTable.workspaceId),
          eq(v.customFieldId, def.id),
          eq(v.entityType, "work_item"),
          eq(v.entityId, workItemTable.id),
          valueCondition,
        ),
      ),
  );
}

/** Parenthesised OR so the group survives being ANDed with the row anchors. */
const anyOf = (conditions: SQL[]) => sql`(${sql.join(conditions, sql` or `)})`;

const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
const textOf = sql`(${v.value} #>> '{}')`;
const isType = (type: string) => sql`jsonb_typeof(${v.value}) = ${type}`;

const COMPARE: Record<string, (left: SQL, right: SQL) => SQL> = {
  gt: (l, r) => sql`${l} > ${r}`,
  gte: (l, r) => sql`${l} >= ${r}`,
  lt: (l, r) => sql`${l} < ${r}`,
  lte: (l, r) => sql`${l} <= ${r}`,
};

/** The SQL condition for one `cf.<key>` leaf; refuses an operator or value the format cannot take. */
export function customFieldClause(
  leaf: { field: string; op: string; value: unknown },
  definitions: CustomFieldFilterDefinitions,
  personId: string,
): SQL {
  const match = CUSTOM_FIELD_FILTER_KEY.exec(leaf.field);
  const def = match?.[1] ? definitions.get(match[1]) : undefined;
  if (!def)
    throw new HTTPException(422, {
      message: `Filter field unavailable: ${leaf.field}`,
    });
  const { op, value, field } = { ...leaf };
  if (!(OPS_BY_FORMAT[def.format] ?? []).includes(op))
    return bad(`${field} (${def.format}) does not support ${op}`);

  if (op === "is_set") {
    if (typeof value !== "boolean")
      return bad(`${field} is_set expects true or false`);
    return value ? hasValue(def) : sql`not ${hasValue(def)}`;
  }

  // One positive condition per (format, op); `neq` is its negation over "has a matching value".
  const positive = (positiveOp: string): SQL => {
    switch (def.format) {
      case "text":
      case "long_text":
      case "url":
      case "email": {
        if (positiveOp === "contains") {
          const text = scalar(value, field);
          return hasValue(
            def,
            sql`${isType("string")} and ${textOf} ilike ${`%${escapeLikePattern(String(text))}%`}`,
          );
        }
        const values = positiveOp === "in" ? list(value, field) : [value];
        return hasValue(
          def,
          anyOf(
            values.map((item) => {
              const text = scalar(item, field);
              return sql`${v.value} = ${jsonb(String(text))}`;
            }),
          ),
        );
      }
      case "number":
      case "decimal": {
        const column = sql`case when ${isType("number")} then ${textOf}::numeric end`;
        if (positiveOp === "in")
          return hasValue(
            def,
            anyOf(
              list(value, field).map(
                (item) => sql`${column} = ${numberOf(item, field)}::numeric`,
              ),
            ),
          );
        const n = numberOf(value, field);
        return hasValue(
          def,
          positiveOp === "eq"
            ? sql`${column} = ${n}::numeric`
            : (COMPARE[positiveOp] as (l: SQL, r: SQL) => SQL)(
                column,
                sql`${n}::numeric`,
              ),
        );
      }
      case "date": {
        const date = String(scalar(value, field));
        if (!isCalendarDate(date)) return bad(`${field} expects YYYY-MM-DD`);
        const column = sql`case when ${isType("string")} then ${textOf} end`;
        return hasValue(
          def,
          positiveOp === "eq"
            ? sql`${column} = ${date}`
            : (COMPARE[positiveOp] as (l: SQL, r: SQL) => SQL)(
                column,
                sql`${date}`,
              ),
        );
      }
      case "datetime": {
        const raw = String(scalar(value, field));
        const instant = isCalendarDate(raw)
          ? new Date(`${raw}T00:00:00.000Z`)
          : /(Z|[+-]\d{2}:\d{2})$/u.test(raw)
            ? new Date(raw)
            : new Date(Number.NaN);
        if (Number.isNaN(instant.getTime()))
          return bad(`${field} expects a date or an ISO date and time`);
        const column = sql`case when ${isType("string")} then (${textOf})::timestamptz end`;
        return hasValue(
          def,
          (COMPARE[positiveOp] as (l: SQL, r: SQL) => SQL)(
            column,
            sql`${instant.toISOString()}::timestamptz`,
          ),
        );
      }
      case "boolean": {
        const raw = scalar(value, field);
        const flag =
          raw === true || raw === "true"
            ? true
            : raw === false || raw === "false"
              ? false
              : bad(`${field} expects true or false`);
        return hasValue(def, sql`${v.value} = ${jsonb(flag)}`);
      }
      case "select": {
        const keys =
          positiveOp === "in"
            ? list(value, field).map((item) => optionOf(def, item, field))
            : [optionOf(def, value, field)];
        return hasValue(
          def,
          anyOf(keys.map((key) => sql`${v.value} = ${jsonb(key)}`)),
        );
      }
      case "multi_select": {
        const keys =
          positiveOp === "in"
            ? list(value, field).map((item) => optionOf(def, item, field))
            : [optionOf(def, value, field)];
        return hasValue(
          def,
          anyOf(keys.map((key) => sql`${v.value} @> ${jsonb([key])}`)),
        );
      }
      case "user":
        if (value !== "@me") return bad(`${field} supports eq @me only`);
        return hasValue(def, sql`${v.value} = ${jsonb(personId)}`);
      case "multi_user":
        if (value !== "@me") return bad(`${field} supports contains @me only`);
        return hasValue(def, sql`${v.value} @> ${jsonb([personId])}`);
      default:
        return bad(`${field} (${def.format}) cannot be filtered`);
    }
  };
  return op === "neq" ? sql`not ${positive("eq")}` : positive(op);
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20)
    return bad(`${field} in expects 1 to 20 values`);
  return value;
}

/** Synchronous shape check for a `cf.<key>` leaf; format-specific rules run at execution. */
export function customFieldLeafShapeProblem(
  op: string,
  value: unknown,
): string | null {
  if (!(CUSTOM_FIELD_FILTER_OPS as readonly string[]).includes(op))
    return "unknown operator";
  const simple = (item: unknown) =>
    (typeof item === "string" &&
      item.length > 0 &&
      item.length <= 200 &&
      !item.includes("\0")) ||
    (typeof item === "number" && Number.isFinite(item)) ||
    typeof item === "boolean";
  if (op === "is_set")
    return typeof value === "boolean" ? null : "is_set expects true or false";
  if (op === "in")
    return Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= 20 &&
      value.every(simple)
      ? null
      : "in expects 1 to 20 values";
  return simple(value) ? null : "expects a single value";
}
