export type WorkItemFilter =
  | { op: "and" | "or"; clauses: WorkItemFilter[] }
  | { field: string; op: string; value: string | string[] };

/** Parses the bounded filter-only text editor into the endpoint's canonical AST. */
export function parseWorkItemFilterText(
  source: string,
): WorkItemFilter | undefined {
  if (!source.trim()) return undefined;
  if (source.length > 8192)
    throw new Error("Filter text is limited to 8192 characters.");
  const tokens: string[] = [];
  for (let i = 0; i < source.length; ) {
    if (/\s/u.test(source[i]!)) {
      i++;
      continue;
    }
    if ("(),".includes(source[i]!)) {
      tokens.push(source[i++]!);
      continue;
    }
    if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && (source[j] !== '"' || source[j - 1] === "\\"))
        j++;
      if (j >= source.length)
        throw new Error("Unterminated quoted filter value.");
      tokens.push(JSON.parse(source.slice(i, j + 1)) as string);
      i = j + 1;
      continue;
    }
    const m = /^[^\s(),"]+/u.exec(source.slice(i));
    if (!m) throw new Error("Invalid filter text.");
    tokens.push(m[0]);
    i += m[0].length;
  }
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const primary = (): WorkItemFilter => {
    if (peek() === "(") {
      take();
      const group = expression(0);
      if (take() !== ")") throw new Error("Unclosed filter group.");
      return group;
    }
    const token = take();
    if (!token) throw new Error("Expected a filter term.");
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
      op = (
        { "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" } as Record<
          string,
          string
        >
      )[compare[1]!]!;
      rest = compare[2]!;
    }
    const call = /^(in|contains)$/u.exec(rest);
    if (call) {
      if (take() !== "(") throw new Error("Expected operator arguments.");
      const values: string[] = [];
      while (peek() !== ")") {
        const value = take();
        if (value === undefined || value === "," || value === "(")
          throw new Error("Invalid operator argument.");
        values.push(value);
        if (peek() === ",") take();
        else if (peek() !== ")")
          throw new Error("Expected comma or closing parenthesis.");
      }
      take();
      const functionOperator = call[1]!;
      return {
        field,
        op: functionOperator,
        value: functionOperator === "in" ? values : (values[0] ?? ""),
      };
    }
    const value =
      rest ||
      (peek() && !["AND", "OR", ")"].includes(peek()!.toUpperCase())
        ? take()!
        : "");
    return { field, op, value };
  };
  const expression = (minimum: number): WorkItemFilter => {
    let left = primary();
    while (peek() && peek() !== ")") {
      const word = peek()!.toUpperCase();
      const precedence = word === "OR" ? 1 : 2;
      if (precedence < minimum) break;
      if (word === "OR" || word === "AND") take();
      const right = expression(precedence + 1);
      const op = word === "OR" ? "or" : "and";
      left = { op, clauses: [left, right] };
    }
    return left;
  };
  const result = expression(0);
  if (at !== tokens.length) throw new Error("Unexpected filter token.");
  return result;
}
