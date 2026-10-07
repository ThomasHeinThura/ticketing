export type WorkItemFilter =
  | { op: "and" | "or"; clauses: WorkItemFilter[] }
  | { field: string; op: string; value: string | string[] };

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

function printValue(value: string): string {
  return /^[\p{L}\p{N}_@./-]+$/u.test(value) &&
    !["AND", "OR"].includes(value.toUpperCase())
    ? value
    : JSON.stringify(value);
}

/** Prints the filter AST without flattening explicit groups or reordering clauses. */
export function printWorkItemFilterText(
  filter: WorkItemFilter | undefined,
): string {
  if (!filter) return "";
  if ("field" in filter) {
    const field = FIELD_TOKENS[filter.field] ?? filter.field;
    if (!/^[\p{L}\p{N}_.-]+$/u.test(field))
      throw new Error(
        `Field cannot be represented in filter text: ${filter.field}`,
      );
    if (filter.op === "contains") {
      if (Array.isArray(filter.value)) {
        if (filter.value.length !== 1)
          throw new Error("The contains operator requires one scalar value.");
        const value = filter.value[0];
        if (value === undefined)
          throw new Error("The contains operator requires one scalar value.");
        return `${field}:contains(${printValue(value)})`;
      }
      return `${field}:contains(${printValue(filter.value)})`;
    }
    if (filter.op === "in") {
      if (!Array.isArray(filter.value)) {
        throw new Error("The in operator requires an array value.");
      }
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
  if (!filter.clauses.length)
    throw new Error("A filter group must contain at least one clause.");
  return `(${filter.clauses.map(printWorkItemFilterText).join(` ${filter.op.toUpperCase()} `)})`;
}

/** Parses the bounded filter-only text editor into the endpoint's canonical AST. */
export function parseWorkItemFilterText(
  source: string,
): WorkItemFilter | undefined {
  if (!source.trim()) return undefined;
  if (source.length > 8192)
    throw new Error("Filter text is limited to 8192 characters.");
  const tokens: Array<{ value: string; quoted?: boolean }> = [];
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
    if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && (source[j] !== '"' || source[j - 1] === "\\"))
        j++;
      if (j >= source.length)
        throw new Error("Unterminated quoted filter value.");
      tokens.push({
        value: JSON.parse(source.slice(i, j + 1)) as string,
        quoted: true,
      });
      i = j + 1;
      continue;
    }
    const m = /^[^\s(),"]+/u.exec(source.slice(i));
    if (!m) throw new Error("Invalid filter text.");
    tokens.push({ value: m[0] });
    i += m[0].length;
  }
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const isKeyword = (word: string) =>
    !peek()?.quoted && peek()?.value.toUpperCase() === word;
  const primary = (): WorkItemFilter => {
    if (peek()?.value === "(") {
      take();
      const group = parseOr();
      if (take()?.value !== ")") throw new Error("Unclosed filter group.");
      return isFilterGroup(group) ? group : { op: "and", clauses: [group] };
    }
    const token = take()?.value;
    if (!token || token === ")") throw new Error("Expected a filter term.");
    const split = token.indexOf(":");
    if (split < 1) throw new Error(`Expected field:value near ${token}.`);
    const alias: Record<string, string> = {
      state: "state.group",
      due: "dueDate",
      created: "createdAt",
    };
    const field = alias[token.slice(0, split)] ?? token.slice(0, split);
    let rest = token.slice(split + 1);
    const compare = /^(<=|>=|<|>)(.*)$/u.exec(rest);
    let op = "eq";
    if (compare) {
      const compareOperator = compare[1];
      const compareValue = compare[2];
      const mappedOperator = compareOperator
        ? (
            { "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" } as Record<
              string,
              string
            >
          )[compareOperator]
        : undefined;
      if (!mappedOperator || compareValue === undefined)
        throw new Error("Invalid comparison operator.");
      op = mappedOperator;
      rest = compareValue;
    }
    const call = /^(in|contains)$/u.exec(rest);
    if (call) {
      if (take()?.value !== "(")
        throw new Error("Expected operator arguments.");
      const values: string[] = [];
      while (peek()?.value !== ")") {
        const value = take()?.value;
        if (value === undefined || value === "," || value === "(")
          throw new Error("Invalid operator argument.");
        values.push(value);
        if (peek()?.value === ",") take();
        else if (peek()?.value !== ")")
          throw new Error("Expected comma or closing parenthesis.");
      }
      take();
      const functionOperator = call[1];
      if (!functionOperator) throw new Error("Invalid filter operator.");
      if (functionOperator === "contains" && values.length !== 1)
        throw new Error("The contains operator requires one value.");
      return {
        field,
        op: functionOperator,
        value: functionOperator === "in" ? values : (values[0] ?? ""),
      };
    }
    const next = peek();
    const value =
      rest ||
      (next && !isKeyword("AND") && !isKeyword("OR") && next.value !== ")"
        ? (take()?.value ?? "")
        : "");
    return { field, op, value };
  };
  const combine = (op: "and" | "or", clauses: WorkItemFilter[]) =>
    clauses.length === 1 ? (clauses[0] ?? { op, clauses }) : { op, clauses };
  const parseAnd = (): WorkItemFilter => {
    const clauses = [primary()];
    while (peek() && peek()?.value !== ")" && !isKeyword("OR")) {
      if (isKeyword("AND")) take();
      clauses.push(primary());
    }
    return combine("and", clauses);
  };
  const parseOr = (): WorkItemFilter => {
    const clauses = [parseAnd()];
    while (isKeyword("OR")) {
      take();
      clauses.push(parseAnd());
    }
    return combine("or", clauses);
  };
  const result = parseOr();
  if (at !== tokens.length) throw new Error("Unexpected filter token.");
  return result;
}

function isFilterGroup(
  filter: WorkItemFilter,
): filter is Extract<WorkItemFilter, { clauses: WorkItemFilter[] }> {
  return "clauses" in filter;
}
