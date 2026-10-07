export type WorkItemFilter =
  | { op: "and" | "or"; clauses: WorkItemFilter[] }
  | { field: string; op: string; value: string | string[] };

type FilterToken = { value: string; quoted?: boolean };

const FIELD_TOKENS: Record<string, string> = {
  "state.group": "state",
  dueDate: "due",
  createdAt: "created",
};

const OPERATOR_TOKENS: Record<string, string> = {
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

const STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const MAX_TEXT_LENGTH = 8192;
const MAX_DEPTH = 8;
const MAX_LEAVES = 64;
const MAX_CLAUSES = 32;
const UNAVAILABLE_FIELD =
  /^(?:sla\.(?:state|due_at)|cf\.[a-zA-Z0-9_.-]+|label)$/u;

function printValue(value: string): string {
  return /^[\p{L}\p{N}_@./-]+$/u.test(value) &&
    !["AND", "OR"].includes(value.toUpperCase())
    ? value
    : JSON.stringify(value);
}

function printNode(filter: WorkItemFilter): string {
  if ("clauses" in filter) {
    if (filter.op !== "and" && filter.op !== "or")
      throw new Error("Filter groups support AND or OR only.");
    return `${filter.op.toUpperCase()}(${filter.clauses.map(printNode).join(",")})`;
  }
  const field = FIELD_TOKENS[filter.field] ?? filter.field;
  if (!/^[\p{L}\p{N}_.-]+$/u.test(field))
    throw new Error(
      `Field cannot be represented in filter text: ${filter.field}`,
    );
  if (filter.op === "contains") {
    if (Array.isArray(filter.value))
      throw new Error("The contains operator requires one scalar value.");
    return `${field}:contains(${printValue(filter.value)})`;
  }
  if (filter.op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0)
      throw new Error("The in operator requires a nonempty array value.");
    return `${field}:in(${filter.value.map(printValue).join(",")})`;
  }
  if (Array.isArray(filter.value))
    throw new Error("Comparison operators require a scalar value.");
  const operator = OPERATOR_TOKENS[filter.op];
  if (operator) return `${field}:${operator}${printValue(filter.value)}`;
  if (filter.op !== "eq")
    throw new Error(
      `Operator cannot be represented in filter text: ${filter.op}`,
    );
  return `${field}:${printValue(filter.value)}`;
}

/** Prints every group explicitly, retaining operator, arity, nesting, and order. */
export function printWorkItemFilterText(
  filter: WorkItemFilter | undefined,
): string {
  if (!filter) return "";
  validateTree(filter);
  return printNode(filter);
}

function tokenize(source: string): FilterToken[] {
  if (source.length > MAX_TEXT_LENGTH)
    throw new Error("Filter text is limited to 8192 characters.");
  const tokens: FilterToken[] = [];
  for (let i = 0; i < source.length; ) {
    const current = source[i];
    if (current === undefined) break;
    if (/\s/u.test(current)) {
      i++;
      continue;
    }
    if ("(),".includes(current)) {
      tokens.push({ value: current });
      i++;
      continue;
    }
    if (current === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < source.length) {
        const character = source[j];
        if (character === undefined) break;
        if (character === '"' && !escaped) break;
        if (character === "\\" && !escaped) escaped = true;
        else escaped = false;
        j++;
      }
      if (j >= source.length)
        throw new Error("Unterminated quoted filter value.");
      let value: unknown;
      try {
        value = JSON.parse(source.slice(i, j + 1)) as unknown;
      } catch {
        throw new Error("Invalid quoted filter value.");
      }
      if (typeof value !== "string" || value.includes("\0"))
        throw new Error("Invalid quoted filter value.");
      tokens.push({ value, quoted: true });
      i = j + 1;
      continue;
    }
    const match = /^[^\s(),"]+/u.exec(source.slice(i));
    if (!match) throw new Error("Invalid filter text.");
    tokens.push({ value: match[0] });
    i += match[0].length;
  }
  return tokens;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function assertValue(value: string, maxLength: number, field: string) {
  if (value.length === 0 || value.length > maxLength || value.includes("\0"))
    throw new Error(`${field} filter has an invalid value.`);
}

function validateLeaf(node: Extract<WorkItemFilter, { field: string }>) {
  const { field, op, value } = node;
  // Preserve the API's explicit 422 for recognized but unavailable fields and its 400
  // for unknown fields; validation below mirrors only the implemented P1 field table.
  if (UNAVAILABLE_FIELD.test(field)) return;
  if (
    ![
      "state.group",
      "priority",
      "assignee",
      "watcher",
      "dueDate",
      "createdAt",
      "project",
      "type",
    ].includes(field)
  )
    return;

  if (field === "state.group") {
    if (op === "eq" && typeof value === "string") {
      assertValue(value, 20, field);
      if (!(STATE_GROUPS as readonly string[]).includes(value))
        throw new Error("state.group requires a supported state group.");
      return;
    }
    if (op === "in" && Array.isArray(value)) {
      if (value.length < 1 || value.length > 20)
        throw new Error("state.group in() requires 1–20 values.");
      if (
        value.some(
          (entry) => !(STATE_GROUPS as readonly string[]).includes(entry),
        )
      )
        throw new Error("state.group requires supported state groups.");
      return;
    }
    throw new Error("state.group accepts eq or in with a known state group.");
  }

  if (field === "priority") {
    if (op === "eq" && typeof value === "string") {
      assertValue(value, 20, field);
      if (!(PRIORITIES as readonly string[]).includes(value))
        throw new Error("priority requires a supported value.");
      return;
    }
    if (op === "in" && Array.isArray(value)) {
      if (value.length < 1 || value.length > 4)
        throw new Error("priority in() requires 1–4 values.");
      if (
        value.some(
          (entry) => !(PRIORITIES as readonly string[]).includes(entry),
        )
      )
        throw new Error("priority requires supported values.");
      return;
    }
    if (["gt", "gte", "lt", "lte"].includes(op) && typeof value === "string") {
      assertValue(value, 20, field);
      if (!(PRIORITIES as readonly string[]).includes(value))
        throw new Error("priority comparison requires a supported value.");
      return;
    }
    throw new Error("priority has an invalid operator or value.");
  }

  if (field === "assignee") {
    if (op === "eq" && value === "@me") return;
    throw new Error("assignee supports eq @me only.");
  }
  if (field === "watcher") {
    if (op === "contains" && value === "@me") return;
    throw new Error("watcher supports contains @me only.");
  }
  if (field === "dueDate") {
    if (["lt", "lte", "gt", "gte"].includes(op) && typeof value === "string") {
      assertValue(value, 32, field);
      const relativeDay =
        /^[1-9]\d{0,3}d$/u.test(value) && Number.parseInt(value, 10) <= 3650;
      if (relativeDay || isCalendarDate(value)) return;
    }
    throw new Error(
      "dueDate expects an ISO calendar date or a 1–3650 day value.",
    );
  }
  if (field === "createdAt") {
    if (
      ["lt", "lte", "gt", "gte"].includes(op) &&
      typeof value === "string" &&
      value.length <= 10 &&
      isCalendarDate(value)
    )
      return;
    throw new Error("createdAt expects an ISO calendar date.");
  }
  if (field === "project" || field === "type") {
    if (op === "eq" && typeof value === "string") {
      assertValue(value, 100, field);
      return;
    }
    throw new Error(`${field} supports eq with a string value.`);
  }
}

function validateTree(root: WorkItemFilter) {
  let leaves = 0;
  const visit = (node: WorkItemFilter, depth: number) => {
    if (depth > MAX_DEPTH) throw new Error("Filter exceeds maximum depth 8.");
    if ("clauses" in node) {
      if (node.op !== "and" && node.op !== "or")
        throw new Error("Filter groups support AND or OR only.");
      if (node.clauses.length < 1 || node.clauses.length > MAX_CLAUSES)
        throw new Error("Filter groups require 1–32 clauses.");
      for (const child of node.clauses) visit(child, depth + 1);
      return;
    }
    leaves++;
    if (leaves > MAX_LEAVES)
      throw new Error("Filter exceeds maximum 64 leaves.");
    validateLeaf(node);
  };
  visit(root, 1);
}

/** Parses the bounded filter-only text editor into the endpoint's canonical AST. */
export function parseWorkItemFilterText(
  source: string,
): WorkItemFilter | undefined {
  if (!source.trim()) return undefined;
  const tokens = tokenize(source);
  let position = 0;
  const peek = (offset = 0) => tokens[position + offset];
  const take = () => tokens[position++];
  const isKeyword = (word: string, offset = 0) =>
    !peek(offset)?.quoted && peek(offset)?.value.toUpperCase() === word;
  let parseOr: () => WorkItemFilter;

  const parseExplicitGroup = (): WorkItemFilter => {
    const operatorToken = take();
    const op = operatorToken?.value.toUpperCase() === "OR" ? "or" : "and";
    if (take()?.value !== "(") throw new Error("Expected an explicit group.");
    const clauses: WorkItemFilter[] = [];
    if (peek()?.value === ")")
      throw new Error("Filter groups cannot be empty.");
    while (true) {
      clauses.push(parseOr());
      if (peek()?.value === ",") {
        take();
        if (peek()?.value === ")" || peek() === undefined)
          throw new Error("Filter groups cannot have a trailing comma.");
        continue;
      }
      if (take()?.value !== ")")
        throw new Error("Expected comma or closing group.");
      break;
    }
    if (clauses.length > MAX_CLAUSES)
      throw new Error("Filter groups require at most 32 clauses.");
    return { op, clauses };
  };

  const parsePrimary = (): WorkItemFilter => {
    if ((isKeyword("AND") || isKeyword("OR")) && peek(1)?.value === "(")
      return parseExplicitGroup();
    if (peek()?.value === "(") {
      take();
      const group = parseOr();
      if (take()?.value !== ")") throw new Error("Unclosed filter group.");
      return group;
    }
    const token = take()?.value;
    if (!token || token === ")" || token === ",")
      throw new Error("Expected a filter term.");
    const split = token.indexOf(":");
    if (split < 1) throw new Error(`Expected field:value near ${token}.`);
    const aliases: Record<string, string> = {
      state: "state.group",
      due: "dueDate",
      created: "createdAt",
    };
    const field = aliases[token.slice(0, split)] ?? token.slice(0, split);
    let rest = token.slice(split + 1);
    const comparison = /^(<=|>=|<|>)(.*)$/u.exec(rest);
    let op = "eq";
    if (comparison) {
      const symbols: Record<string, string> = {
        "<": "lt",
        "<=": "lte",
        ">": "gt",
        ">=": "gte",
      };
      const symbol = comparison[1];
      const mapped = symbol ? symbols[symbol] : undefined;
      const comparisonValue = comparison[2];
      if (!mapped || comparisonValue === undefined)
        throw new Error("Invalid comparison operator.");
      op = mapped;
      rest = comparisonValue;
    }

    const call = /^(in|contains)$/u.exec(rest);
    let value: string | string[];
    if (call) {
      if (take()?.value !== "(")
        throw new Error("Expected operator arguments.");
      const values: string[] = [];
      if (peek()?.value === ")")
        throw new Error(`${call[1]}() requires a value.`);
      while (true) {
        const next = take();
        if (
          !next ||
          next.value === "," ||
          next.value === "(" ||
          next.value === ")"
        )
          throw new Error("Invalid operator argument.");
        values.push(next.value);
        if (peek()?.value === ",") {
          take();
          if (peek()?.value === ")" || peek() === undefined)
            throw new Error("Operator lists cannot have a trailing comma.");
          continue;
        }
        if (take()?.value !== ")")
          throw new Error("Expected comma or closing parenthesis.");
        break;
      }
      op = call[1] ?? "";
      if (op === "contains" && values.length !== 1)
        throw new Error("The contains operator requires one value.");
      value = op === "in" ? values : (values[0] ?? "");
    } else {
      const next = peek();
      value =
        rest ||
        (next &&
        !isKeyword("AND") &&
        !isKeyword("OR") &&
        next.value !== ")" &&
        next.value !== ","
          ? (take()?.value ?? "")
          : "");
    }
    const leaf = { field, op, value };
    validateLeaf(leaf);
    return leaf;
  };

  const parseAnd = (): WorkItemFilter => {
    const clauses = [parsePrimary()];
    while (
      peek() &&
      peek()?.value !== ")" &&
      peek()?.value !== "," &&
      !isKeyword("OR")
    ) {
      if (isKeyword("AND")) take();
      clauses.push(parsePrimary());
      if (clauses.length > MAX_CLAUSES)
        throw new Error("Filter groups require at most 32 clauses.");
    }
    return clauses.length === 1
      ? (clauses[0] ?? { op: "and", clauses })
      : { op: "and", clauses };
  };
  parseOr = () => {
    const clauses = [parseAnd()];
    while (isKeyword("OR")) {
      take();
      clauses.push(parseAnd());
      if (clauses.length > MAX_CLAUSES)
        throw new Error("Filter groups require at most 32 clauses.");
    }
    return clauses.length === 1
      ? (clauses[0] ?? { op: "or", clauses })
      : { op: "or", clauses };
  };

  const result = parseOr();
  if (position !== tokens.length) throw new Error("Unexpected filter token.");
  validateTree(result);
  return result;
}
