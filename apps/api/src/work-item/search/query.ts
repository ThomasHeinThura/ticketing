import { STATE_GROUPS } from "@taskdesk/domain";
import { HTTPException } from "hono/http-exception";
import {
  CUSTOM_FIELD_FILTER_KEY,
  customFieldLeafShapeProblem,
} from "./custom-field-filter";

export type SearchFilter =
  | { op: "and" | "or"; clauses: SearchFilter[] }
  | { field: string; op: string; value: unknown };

export type WorkItemSearchQuery = {
  entity: "work_item";
  filter?: SearchFilter;
  sort?: {
    field: WorkItemSearchSortField;
    order: "asc" | "desc";
  }[];
  columns?: WorkItemSearchColumn[];
};

export type WorkItemSearchColumn =
  | "key"
  | "title"
  | "state"
  | "assignee"
  | "priority"
  | "dueDate"
  | `cf.${string}`;

export type WorkItemSearchSortField =
  | "key"
  | "position"
  | "title"
  | "state"
  | "assignee"
  | "priority"
  | "dueDate"
  | `cf.${string}`;

const WORK_ITEM_SEARCH_NATIVE_COLUMNS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;
const CUSTOM_FIELD_COLUMN = /^cf\.[a-z][a-z0-9_]{0,63}$/u;

function isWorkItemSearchColumn(value: unknown): value is WorkItemSearchColumn {
  return (
    typeof value === "string" &&
    ((WORK_ITEM_SEARCH_NATIVE_COLUMNS as readonly string[]).includes(value) ||
      CUSTOM_FIELD_COLUMN.test(value))
  );
}

export function hasWorkItemLifecycleFilter(
  filter: SearchFilter | undefined,
): boolean {
  if (!filter) return false;
  if ("clauses" in filter)
    return filter.clauses.some(hasWorkItemLifecycleFilter);
  return filter.field === "lifecycle";
}

const priorities = ["low", "medium", "high", "urgent"] as const;
// VW-31: recognised-but-unbacked fields return 422 naming the field. `organisation` resolves
// through project.organisation_id but has no whitelisted operator/value contract in the P1
// table, so it stays unavailable (never an empty or unfiltered result).
const unavailable =
  /^(?:sla\.(?:state|due_at)|label|cycle|module|epic|organisation)$/u;
const knownUnavailable = (field: string) => unavailable.test(field);

function bad(message: string): never {
  throw new HTTPException(400, { message });
}
function unavailableField(field: string): never {
  throw new HTTPException(422, {
    message: `Filter field unavailable: ${field}`,
  });
}

export function validateWorkItemSearchQuery(
  input: unknown,
): WorkItemSearchQuery {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return bad("query must be an object");
  const q = input as Record<string, unknown>;
  for (const key of Object.keys(q))
    if (
      !["entity", "filter", "sort", "groupBy", "columns", "aggregate"].includes(
        key,
      )
    )
      bad(`Unknown query key: ${key}`);
  if (q.entity !== "work_item")
    throw new HTTPException(422, {
      message: "P1 search supports entity work_item only",
    });
  if (q.groupBy !== undefined || q.aggregate !== undefined)
    throw new HTTPException(422, {
      message: "groupBy and aggregate are not available in P1 work-item search",
    });
  let leaves = 0;
  const check = (node: unknown, depth: number): SearchFilter => {
    if (depth > 8) return bad("filter exceeds maximum depth 8");
    if (!node || typeof node !== "object" || Array.isArray(node))
      return bad("filter node must be an object");
    const n = node as Record<string, unknown>;
    if (n.op === "and" || n.op === "or") {
      if (Object.keys(n).some((k) => !["op", "clauses"].includes(k)))
        return bad("invalid filter group keys");
      if (
        !Array.isArray(n.clauses) ||
        n.clauses.length < 1 ||
        n.clauses.length > 32
      )
        return bad("filter group clauses must contain 1–32 nodes");
      return {
        op: n.op,
        clauses: n.clauses.map((child) => check(child, depth + 1)),
      };
    }
    if (
      Object.keys(n).some((k) => !["field", "op", "value"].includes(k)) ||
      typeof n.field !== "string" ||
      typeof n.op !== "string" ||
      !("value" in n)
    )
      return bad("invalid filter leaf");
    leaves++;
    if (leaves > 64) return bad("filter exceeds maximum 64 leaves");
    const { field, op, value } = n;
    if (knownUnavailable(field)) return unavailableField(field);
    const string = (v: unknown, max = 200): v is string =>
      typeof v === "string" &&
      v.length > 0 &&
      v.length <= max &&
      !v.includes("\0");
    const array = (vals: unknown, accepted: readonly string[]) =>
      Array.isArray(vals) &&
      vals.length > 0 &&
      vals.length <= 20 &&
      vals.every((v) => typeof v === "string" && accepted.includes(v));
    // CF-10: `cf.<key>`. The key pattern, operator and value shape are checked here; the
    // field's existence and format need the workspace and are checked when the search runs.
    if (field.startsWith("cf.")) {
      if (!CUSTOM_FIELD_FILTER_KEY.test(field))
        return bad(`Unknown filter field: ${field}`);
      const problem = customFieldLeafShapeProblem(op, value);
      if (problem) return bad(`${field}: ${problem}`);
      return { field, op, value };
    }
    switch (field) {
      case "state.group":
        if (
          op === "eq" &&
          string(value, 20) &&
          (STATE_GROUPS as readonly string[]).includes(value)
        )
          break;
        if (op === "in" && array(value, STATE_GROUPS)) break;
        return bad("state.group accepts eq or in with a known state group");
      case "priority":
        if (
          ["eq", "in"].includes(op) &&
          (op === "eq"
            ? string(value, 20) && priorities.includes(value as never)
            : array(value, priorities))
        )
          break;
        if (
          ["gt", "gte", "lt", "lte"].includes(op) &&
          string(value, 20) &&
          priorities.includes(value as never)
        )
          break;
        return bad("priority has an invalid operator or value");
      case "assignee":
      case "requester":
        if (op === "eq" && value === "@me") break;
        return bad(`${field} supports eq @me only`);
      case "watcher":
        if (op === "contains" && value === "@me") break;
        return bad("watcher supports contains @me only");
      case "dueDate":
        if (
          ["lt", "lte", "gt", "gte"].includes(op) &&
          string(value, 32) &&
          ((/^[1-9]\d{0,3}d$/u.test(value) &&
            Number.parseInt(value, 10) <= 3650) ||
            isCalendarDate(value))
        )
          break;
        return bad("dueDate expects a calendar date or relative day value");
      case "createdAt":
        if (
          ["lt", "lte", "gt", "gte"].includes(op) &&
          string(value, 10) &&
          isCalendarDate(value)
        )
          break;
        return bad("createdAt expects an ISO calendar date");
      case "project":
        if (op === "eq" && string(value, 100)) break;
        return bad("project supports eq with a slug");
      case "type":
        if (op === "eq" && string(value, 100)) break;
        return bad("type supports eq with a type key");
      case "lifecycle":
        if (
          op === "eq" &&
          string(value, 20) &&
          ["active", "archived", "deleted"].includes(value)
        )
          break;
        return bad("lifecycle supports eq active, archived, or deleted");
      default:
        return bad(`Unknown filter field: ${field}`);
    }
    return { field, op, value };
  };
  let filter: SearchFilter | undefined;
  if (q.filter !== undefined) filter = check(q.filter, 1);
  let sort: WorkItemSearchQuery["sort"];
  if (q.sort !== undefined) {
    if (!Array.isArray(q.sort) || q.sort.length > 5)
      return bad("sort must contain at most five items");
    const seenSortFields = new Set<string>();
    sort = q.sort.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return bad("invalid sort item");
      const item = entry as Record<string, unknown>;
      if (
        Object.keys(item).some((k) => !["field", "order"].includes(k)) ||
        !isWorkItemSearchSortField(item.field) ||
        !["asc", "desc"].includes(String(item.order))
      )
        return bad("invalid sort field or order");
      if (seenSortFields.has(item.field))
        return bad("sort fields must be unique");
      seenSortFields.add(item.field);
      return {
        field: item.field,
        order: item.order as "asc" | "desc",
      };
    });
  }
  let columns: WorkItemSearchQuery["columns"];
  if (q.columns !== undefined) {
    if (
      !Array.isArray(q.columns) ||
      q.columns.length > 100 ||
      q.columns.some((column) => !isWorkItemSearchColumn(column)) ||
      new Set(q.columns).size !== q.columns.length
    )
      return bad(
        "columns must be a unique subset of registered work-item columns",
      );
    columns = q.columns;
  }
  return {
    entity: "work_item",
    ...(filter ? { filter } : {}),
    ...(sort ? { sort } : {}),
    ...(columns ? { columns } : {}),
  };
}

function isWorkItemSearchSortField(
  value: unknown,
): value is WorkItemSearchSortField {
  return (
    typeof value === "string" &&
    ([
      "key",
      "position",
      "title",
      "state",
      "assignee",
      "priority",
      "dueDate",
    ].includes(value) ||
      /^cf\.[a-z][a-z0-9_]{0,63}$/u.test(value))
  );
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

// Lexer/parser/printer deliberately operate on values, not SQL syntax. Reserved string
// characters are emitted via JSON strings so a printed AST can always be parsed again.
type Token = { value: string; quoted?: boolean };
function lex(text: string): Token[] {
  if (text.length > 8192) bad("filter text exceeds 8192 characters");
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/u.test(text[i]!)) {
      i++;
      continue;
    }
    if (text[i] === "(") {
      out.push({ value: "(" });
      i++;
      continue;
    }
    if (text[i] === ")") {
      out.push({ value: ")" });
      i++;
      continue;
    }
    if (text[i] === ",") {
      out.push({ value: "," });
      i++;
      continue;
    }
    if (text[i] === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < text.length) {
        const c = text[j]!;
        if (c === '"' && !escaped) break;
        escaped = c === "\\" && !escaped;
        if (c !== "\\") escaped = false;
        j++;
      }
      if (j >= text.length) bad("unterminated quoted filter value");
      let value: unknown;
      try {
        value = JSON.parse(text.slice(i, j + 1));
      } catch {
        return bad("invalid quoted filter value");
      }
      if (
        typeof value !== "string" ||
        value.length > 200 ||
        value.includes("\0")
      )
        bad("invalid quoted filter value");
      out.push({ value, quoted: true });
      i = j + 1;
      continue;
    }
    const match = /^[^\s(),"]+/u.exec(text.slice(i));
    if (!match) bad("invalid filter text");
    out.push({ value: match[0] });
    i += match[0].length;
  }
  return out;
}

export function parseFilterText(text: string): SearchFilter {
  const tokens = lex(text);
  let pos = 0;
  const peek = () => tokens[pos]?.value;
  const take = () => tokens[pos++];
  const primary = (): SearchFilter => {
    if (peek() === "(") {
      take();
      const node = expression(0);
      if (take()?.value !== ")") bad("unclosed filter group");
      return node;
    }
    const t = take();
    if (!t) return bad("expected filter term");
    const colon = t.value.indexOf(":");
    if (colon < 1) return bad(`expected field:value, got ${t.value}`);
    const rawField = t.value.slice(0, colon);
    const field =
      (
        {
          state: "state.group",
          due: "dueDate",
          created: "createdAt",
        } as Record<string, string>
      )[rawField] ?? rawField;
    let rest = t.value.slice(colon + 1);
    let op = "eq";
    let value: unknown;
    const comparison = /^(<=|>=|!=|<|>)(.*)$/u.exec(rest);
    if (comparison) {
      op = (
        {
          "<": "lt",
          "<=": "lte",
          ">": "gt",
          ">=": "gte",
          "!=": "neq",
        } as Record<string, string>
      )[comparison[1]!]!;
      rest = comparison[2]!;
    }
    const call = /^(in|contains)$/u.exec(rest);
    if (call) {
      if (take()?.value !== "(") bad("expected operator arguments");
      const vals: string[] = [];
      while (peek() !== ")") {
        const next = take();
        if (!next || next.value === "," || next.value === "(")
          bad("invalid operator argument");
        vals.push(next.value);
        if (peek() === ",") take();
        else if (peek() !== ")") bad("expected comma or closing parenthesis");
      }
      take();
      op = call[1]!;
      value = op === "in" ? vals : vals[0];
    } else if (
      rest.length === 0 &&
      peek() &&
      peek() !== "AND" &&
      peek() !== "OR" &&
      peek() !== ")"
    ) {
      const next = take()!;
      value = next.value;
    } else if (
      field.startsWith("cf.") &&
      !t.quoted &&
      (rest === "is_set" || rest === "not_set")
    ) {
      // CF-10: `cf.<key>:is_set` / `cf.<key>:not_set`.
      op = "is_set";
      value = rest === "is_set";
    } else value = t.quoted ? t.value : rest;
    return { field, op, value };
  };
  const expression = (min: number): SearchFilter => {
    let left = primary();
    while (peek() && peek() !== ")") {
      const word = peek()!.toUpperCase();
      const precedence = word === "OR" ? 1 : word === "AND" ? 2 : 2;
      if (precedence < min) break;
      if (word === "OR" || word === "AND") take();
      const right = expression(precedence + 1);
      const op = word === "OR" ? "or" : "and";
      left = { op, clauses: [left, right] };
    }
    return left;
  };
  if (tokens.length === 0) return bad("filter text is empty");
  const result = expression(0);
  if (pos !== tokens.length) bad("unexpected filter token");
  return validateWorkItemSearchQuery({ entity: "work_item", filter: result })
    .filter!;
}

function printValue(value: string): string {
  return /[\s(),:<>"\\]|^[!=]|^(?:is_set|not_set)$/u.test(value)
    ? JSON.stringify(value)
    : value;
}
export function printFilterText(filter: SearchFilter): string {
  if ("clauses" in filter)
    return filter.clauses
      .map((n) => printFilterText(n))
      .join(` ${filter.op.toUpperCase()} `)
      .replace(/^/u, "(")
      .replace(/$/u, ")");
  const aliases: Record<string, string> = {
    "state.group": "state",
    dueDate: "due",
    createdAt: "created",
  };
  const f = aliases[filter.field] ?? filter.field;
  if (filter.op === "in")
    return `${f}:in(${(filter.value as string[]).map(printValue).join(",")})`;
  if (filter.op === "contains")
    return `${f}:contains(${printValue(String(filter.value))})`;
  if (filter.op === "is_set")
    return `${f}:${filter.value === false ? "not_set" : "is_set"}`;
  const symbols: Record<string, string> = {
    eq: "",
    neq: "!=",
    lt: "<",
    lte: "<=",
    gt: ">",
    gte: ">=",
  };
  return `${f}:${symbols[filter.op] ?? `${filter.op} `}${printValue(String(filter.value))}`;
}

export const SEARCH_BODY_MAX_BYTES = 32 * 1024;
