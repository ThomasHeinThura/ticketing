/**
 * Finds and classifies every environment read in a source file.
 *
 * This is deliberately not `grep process.env`. The kaneo import proved a grep for named
 * reads misses the reads that matter: the seven S3 connection variables go through a local
 * `env(name)` helper backed by `process.env[name]`, four `CREEM_PRODUCT_*` names are built
 * from a lookup table, and the eight `SMTP_*` names arrive through the parameter default
 * `env: SmtpEnv = process.env`. None of those is a `process.env.NAME` expression.
 *
 * So every occurrence of the environment object is classified, and anything whose name
 * cannot be resolved to a string literal is reported as **unattributable** rather than
 * ignored. That is the invariant check:env enforces: every environment read is
 * attributable to an approved entry in docs/05-operations/configuration-reference.md.
 */

/** `import.meta.env` members Vite defines itself; they are not deployment configuration. */
export const viteBuiltIns = new Set([
  "MODE",
  "DEV",
  "PROD",
  "SSR",
  "BASE_URL",
  "LEGACY",
]);

function tokenize(source) {
  const tokens = [];
  const add = (value, type, start, end) =>
    tokens.push({ value, type, start, end });
  const regexPrefixKeywords = new Set([
    "await",
    "case",
    "delete",
    "do",
    "else",
    "in",
    "instanceof",
    "return",
    "throw",
    "typeof",
    "void",
    "yield",
  ]);
  const regexPrefixPunctuation = new Set([
    "(",
    "[",
    "{",
    "=",
    ":",
    ",",
    ";",
    "!",
    "?",
    "?.",
    "=>",
    "&&",
    "||",
    "??",
    "+",
    "-",
    "*",
    "%",
    "&",
    "|",
    "^",
    "<",
    ">",
  ]);
  const canStartRegex = (previous) => {
    if (!previous) return true;
    if (
      regexPrefixKeywords.has(previous.value) ||
      regexPrefixPunctuation.has(previous.value)
    )
      return true;
    if (previous.value === ")") {
      let depth = 0;
      for (
        let tokenIndex = tokens.length - 1;
        tokenIndex >= 0;
        tokenIndex -= 1
      ) {
        const value = tokens[tokenIndex].value;
        if (value === ")") depth += 1;
        else if (value === "(" && --depth === 0) {
          return new Set(["if", "while", "for", "with", "switch", "catch"]).has(
            tokens[tokenIndex - 1]?.value,
          );
        }
      }
    }
    // A slash after a statement block starts a new expression. Distinguish that
    // closing brace from an object literal by inspecting the token that opened it.
    if (previous.value === "}") {
      let depth = 0;
      for (
        let tokenIndex = tokens.length - 1;
        tokenIndex >= 0;
        tokenIndex -= 1
      ) {
        const value = tokens[tokenIndex].value;
        if (value === "}") depth += 1;
        else if (value === "{" && --depth === 0) {
          const beforeBlock = tokens[tokenIndex - 1]?.value;
          if (
            !beforeBlock ||
            [";", "}", "else", "try", "finally", "do", "=>"].includes(
              beforeBlock,
            )
          )
            return true;
          if (beforeBlock === ")") {
            let parens = 0;
            for (let open = tokenIndex - 1; open >= 0; open -= 1) {
              if (tokens[open].value === ")") parens += 1;
              else if (tokens[open].value === "(" && --parens === 0) {
                return new Set([
                  "if",
                  "while",
                  "for",
                  "with",
                  "switch",
                  "catch",
                  "function",
                ]).has(tokens[open - 1]?.value);
              }
            }
          }
          return false;
        }
      }
    }
    return false;
  };
  const scan = (from, inTemplateExpression = false) => {
    let index = from;
    let braceDepth = 0;
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }
      if (source.startsWith("//", index)) {
        const end = source.indexOf("\n", index + 2);
        index = end < 0 ? source.length : end + 1;
        continue;
      }
      if (source.startsWith("/*", index)) {
        const end = source.indexOf("*/", index + 2);
        index = end < 0 ? source.length : end + 2;
        continue;
      }
      if (char === "/" && canStartRegex(tokens.at(-1))) {
        index += 1;
        let inCharacterClass = false;
        while (index < source.length && source[index] !== "\n") {
          if (source[index] === "\\") {
            index += 2;
            continue;
          }
          if (source[index] === "[") inCharacterClass = true;
          else if (source[index] === "]") inCharacterClass = false;
          else if (source[index] === "/" && !inCharacterClass) {
            index += 1;
            while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }
      if (inTemplateExpression && char === "}") {
        if (braceDepth === 0) return index + 1;
        braceDepth -= 1;
        add("}", "punct", index, index + 1);
        index += 1;
        continue;
      }
      if (char === "{") {
        if (inTemplateExpression) braceDepth += 1;
        add(char, "punct", index, index + 1);
        index += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        const quote = char;
        const start = index++;
        let value = "";
        while (index < source.length && source[index] !== quote) {
          if (source[index] === "\\" && index + 1 < source.length) {
            value += source[index + 1];
            index += 2;
          } else {
            value += source[index++];
          }
        }
        if (source[index] === quote) index += 1;
        add(value, "string", start, index);
        continue;
      }
      if (char === "`") {
        index += 1;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
            continue;
          }
          if (source[index] === "`") {
            index += 1;
            break;
          }
          if (source.startsWith("${", index)) {
            index = scan(index + 2, true);
            continue;
          }
          index += 1;
        }
        continue;
      }
      if (/[A-Za-z_$]/.test(char)) {
        const start = index++;
        while (index < source.length && /[\w$]/.test(source[index])) index += 1;
        add(source.slice(start, index), "id", start, index);
        continue;
      }
      const operator = ["...", "?."].find((candidate) =>
        source.startsWith(candidate, index),
      );
      if (operator) {
        add(operator, "punct", index, index + operator.length);
        index += operator.length;
        continue;
      }
      add(char, "punct", index, index + 1);
      index += 1;
    }
    return index;
  };
  scan(0);
  return tokens;
}

function collectTokenAliases(tokens) {
  const processAliases = new Set();
  const envAliases = new Set();
  const envAliasDeclarations = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].value === "import" && tokens[i + 1]?.value === "{") {
      let close = i + 2;
      while (close < tokens.length && tokens[close].value !== "}") close += 1;
      if (tokens[close + 2]?.value === "node:process") {
        for (let j = i + 2; j < close; j += 1) {
          if (tokens[j].value === "env") {
            const alias = tokens[j + 1]?.value === "as" ? tokens[j + 2] : null;
            envAliases.add(alias?.value ?? "env");
            envAliasDeclarations.add(alias ? j + 2 : j);
          }
        }
      }
    }
    if (
      tokens[i].type === "id" &&
      tokens[i + 1]?.value === "=" &&
      tokens[i + 2]?.value === "process"
    ) {
      processAliases.add(tokens[i].value);
    }
  }
  return { processAliases, envAliases, envAliasDeclarations };
}

function parseEnvObject(tokens, index, processAliases, envAliases) {
  const value = tokens[index]?.value;
  const processName = value === "process" || processAliases.has(value);
  const globalProcess =
    (value === "global" || value === "globalThis") &&
    tokens[index + 1]?.value === "." &&
    tokens[index + 2]?.value === "process";
  let processIndex = index;
  if (globalProcess) processIndex = index + 2;
  if (processName || globalProcess) {
    const dot = tokens[processIndex + 1]?.value;
    if (
      (dot === "." || dot === "?.") &&
      tokens[processIndex + 2]?.value === "env"
    )
      return { object: "process.env", end: processIndex + 2 };
    if (
      dot === "[" &&
      tokens[processIndex + 2]?.value === "env" &&
      tokens[processIndex + 3]?.value === "]"
    )
      return { object: "process.env", end: processIndex + 3 };
    return null;
  }
  if (
    value === "import" &&
    tokens[index + 1]?.value === "." &&
    tokens[index + 2]?.value === "meta"
  ) {
    const dot = tokens[index + 3]?.value;
    if ((dot === "." || dot === "?.") && tokens[index + 4]?.value === "env")
      return { object: "import.meta.env", end: index + 4 };
    if (
      dot === "[" &&
      tokens[index + 4]?.value === "env" &&
      tokens[index + 5]?.value === "]"
    )
      return { object: "import.meta.env", end: index + 5 };
  }
  if (
    value === "Reflect" &&
    tokens[index + 1]?.value === "." &&
    tokens[index + 2]?.value === "get" &&
    tokens[index + 3]?.value === "("
  ) {
    const source = parseEnvObject(
      tokens,
      index + 3,
      processAliases,
      envAliases,
    );
    if (source) return { object: source.object, end: index + 2 };
    if (
      tokens[index + 3]?.value === "(" &&
      (tokens[index + 4]?.value === "process" ||
        processAliases.has(tokens[index + 4]?.value)) &&
      tokens[index + 5]?.value === "," &&
      tokens[index + 6]?.value === "env"
    ) {
      return { object: "process.env", end: index + 7 };
    }
  }
  if (
    value === "require" &&
    tokens[index + 1]?.value === "(" &&
    tokens[index + 2]?.value === "process" &&
    tokens[index + 3]?.value === ")" &&
    tokens[index + 4]?.value === "." &&
    tokens[index + 5]?.value === "env"
  ) {
    return { object: "process.env", end: index + 5 };
  }
  if (envAliases.has(value)) return { object: "process.env", end: index };
  return null;
}

/**
 * @typedef {object} EnvRead
 * @property {"process.env" | "import.meta.env"} object which environment object was used
 * @property {"named" | "computed" | "alias"} kind how the read was written
 * @property {string | null} name the resolved variable name, when there is one
 * @property {number} line 1-based line number
 * @property {string} snippet the source line, trimmed
 */

/**
 * @param {string} source file contents
 * @returns {EnvRead[]}
 */
export function findEnvReads(source) {
  const tokens = tokenize(source);
  const { processAliases, envAliases, envAliasDeclarations } =
    collectTokenAliases(tokens);
  const reads = [];
  const lines = source.split("\n");
  const addRead = (token, object, kind, name = null) => {
    const line = source.slice(0, token.start).split("\n").length;
    reads.push({
      object,
      kind,
      name,
      line,
      snippet: (lines[line - 1] ?? "").trim(),
    });
  };
  const seen = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (envAliasDeclarations.has(i)) continue;
    if (
      tokens[i].value === "process" &&
      tokens[i - 1]?.value === "=" &&
      tokens[i - 2]?.value === "}"
    ) {
      let open = i - 3;
      while (open >= 0 && tokens[open].value !== "{") open -= 1;
      for (let key = open + 1; open >= 0 && key < i - 2; key += 1) {
        const value = tokens[key].value;
        if (value === "env" && tokens[key - 1]?.value !== ":") {
          addRead(tokens[i], "process.env", "alias");
          break;
        }
      }
    }
    const parsed = parseEnvObject(tokens, i, processAliases, envAliases);
    if (!parsed) continue;
    const token = tokens[i];
    let kind = "alias";
    let name = null;
    const next = tokens[parsed.end + 1];
    if (next?.value === "." || next?.value === "?.") {
      kind = "named";
      name = tokens[parsed.end + 2]?.value ?? null;
    } else if (next?.value === "[") {
      const member = tokens[parsed.end + 2];
      const close = tokens[parsed.end + 3];
      if (close?.value !== "]") kind = "computed";
      else if (member?.type === "string") {
        kind = "named";
        name = member.value;
      } else kind = "computed";
    } else if (tokens[parsed.end]?.value === "env" && next?.type === "id") {
      kind = "named";
      name = next.value;
    }

    // Destructuring the whole process.env object resolves the requested keys individually.
    if (
      kind === "alias" &&
      tokens[parsed.end]?.value === "env" &&
      tokens[parsed.end + 1]?.value === ";"
    ) {
      const equals = tokens[i - 1]?.value === "=" ? i - 1 : -1;
      if (equals > 0 && tokens[equals - 1]?.value === "}") {
        let open = equals - 2;
        while (open >= 0 && tokens[open].value !== "{") open -= 1;
        for (let key = open + 1; open >= 0 && key < equals - 1; key += 1) {
          if (tokens[key].type === "id" && tokens[key - 1]?.value !== ":") {
            const id = `${tokens[i].start}:${tokens[key].value}`;
            if (!seen.has(id)) {
              seen.add(id);
              addRead(token, parsed.object, "named", tokens[key].value);
            }
          }
        }
        continue;
      }
    }
    const id = `${token.start}:${parsed.object}:${kind}:${name ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    addRead(token, parsed.object, kind, name);
  }
  return reads;
}

/**
 * A stable identity for one unattributable read.
 *
 * **GPT-F3.** `env-baseline.json` recorded unattributable reads as a COUNT per file —
 * `{ reason, reads: 1 }` — and that count was compared against the merge base by
 * `addedWithinKeys`, which compares arrays. The value was an object, so the comparison
 * silently saw two empty lists and returned `[]` for every possible change:
 *
 *   base:  "apps/api/src/storage/s3.ts": { reason: "…", reads: 1 }
 *   diff:  a second computed `process.env[…]` read, plus reads: 1 -> 2
 *   result: check:env GREEN
 *
 * Same-diff bypass, one level below the one F3 closed. A count is also blind to a
 * replacement: delete one baselined read, add a different one, and the number is
 * unchanged while the debt is not.
 *
 * So the baseline records identities instead. The identity is the read's kind plus the
 * source line it sits on, whitespace-collapsed, with a 1-based index to separate
 * genuinely identical lines. Deliberately NOT the line number: inserting an unrelated
 * function above a baselined read would otherwise register as new debt, and a ratchet
 * that fires on unrelated edits is a ratchet people delete.
 *
 * @param {EnvRead} read
 * @param {number} index 1-based, among reads sharing this fingerprint body
 * @returns {string}
 */
export function readFingerprint(read, index) {
  const snippet = read.snippet.replace(/\s+/g, " ").trim();
  return `${read.kind} #${index}: ${snippet}`;
}

/**
 * Fingerprints for a file's unattributable reads, in source order, de-duplicated by
 * appending an occurrence index.
 *
 * @param {EnvRead[]} reads
 * @returns {string[]}
 */
export function readFingerprints(reads) {
  const seen = new Map();
  return reads.map((read) => {
    const body = `${read.kind}: ${read.snippet.replace(/\s+/g, " ").trim()}`;
    const index = (seen.get(body) ?? 0) + 1;
    seen.set(body, index);
    return readFingerprint(read, index);
  });
}
