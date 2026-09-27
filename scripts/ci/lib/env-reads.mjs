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

/**
 * Decodes one `\uXXXX` or `\u{X...}` identifier escape at `source[index]` (which must be
 * the backslash). Returns `null` if it isn't a well-formed escape. JavaScript identifiers
 * may contain these escapes (`process` is the identifier `process`), so the tokenizer
 * decodes them rather than treating the backslash as ending the identifier — otherwise an
 * escaped `process`/`env`/`global`/`require`/`import` reads as several unrelated tokens and
 * every check below silently stops matching it (issue #342, D3).
 */
function readIdentifierUnicodeEscape(source, index) {
  if (source[index] !== "\\" || source[index + 1] !== "u") return null;
  if (source[index + 2] === "{") {
    const close = source.indexOf("}", index + 3);
    if (close < 0) return null;
    const hex = source.slice(index + 3, close);
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return null;
    return { char: String.fromCodePoint(codePoint), length: close + 1 - index };
  }
  const hex = source.slice(index + 2, index + 6);
  if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
  return { char: String.fromCharCode(Number.parseInt(hex, 16)), length: 6 };
}

function tokenize(source) {
  const tokens = [];
  const comments = [];
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
  const expressionPrefixKeywords = new Set([
    "await",
    "return",
    "throw",
    "yield",
    "typeof",
    "void",
    "delete",
    "new",
  ]);
  const expressionPrefixPunctuation = new Set([
    "=",
    "(",
    "[",
    ":",
    ",",
    "=>",
    "+",
    "-",
    "!",
    "~",
  ]);
  const isExpressionPrefix = (value) =>
    expressionPrefixKeywords.has(value) ||
    expressionPrefixPunctuation.has(value);
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
                if (
                  new Set([
                    "if",
                    "while",
                    "for",
                    "with",
                    "switch",
                    "catch",
                  ]).has(tokens[open - 1]?.value)
                )
                  return true;
                // Named function declarations have a name between the keyword
                // and parameter list, unlike function expressions' lexical use.
                for (let prior = open - 1; prior >= 0; prior -= 1) {
                  if ([";", "{", "}"].includes(tokens[prior].value)) break;
                  if (tokens[prior].value === "function") {
                    const beforeFunction =
                      tokens[prior - 1]?.value === "async"
                        ? tokens[prior - 2]?.value
                        : tokens[prior - 1]?.value;
                    return !isExpressionPrefix(beforeFunction);
                  }
                }
                return false;
              }
            }
          }
          // A class declaration's opening brace follows its optional name and
          // extends clause rather than a parenthesized control condition.
          if (beforeBlock && tokens[tokenIndex - 2]?.value === "class")
            return true;
          if (beforeBlock) {
            for (let prior = tokenIndex - 1; prior >= 0; prior -= 1) {
              if ([";", "{", "}"].includes(tokens[prior].value)) break;
              if (tokens[prior].value === "class")
                return !isExpressionPrefix(tokens[prior - 1]?.value);
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
        const start = index;
        const end = source.indexOf("\n", index + 2);
        index = end < 0 ? source.length : end + 1;
        comments.push({ start, end: index });
        continue;
      }
      if (source.startsWith("/*", index)) {
        const start = index;
        const end = source.indexOf("*/", index + 2);
        index = end < 0 ? source.length : end + 2;
        comments.push({ start, end: index });
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
        while (
          index < source.length &&
          source[index] !== quote &&
          source[index] !== "\n" &&
          source[index] !== "\r"
        ) {
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
        const start = index++;
        let value = "";
        let hasInterpolation = false;
        while (index < source.length) {
          if (source[index] === "\\") {
            value += source[index + 1] ?? "";
            index += 2;
            continue;
          }
          if (source[index] === "`") {
            index += 1;
            break;
          }
          if (source.startsWith("${", index)) {
            hasInterpolation = true;
            index = scan(index + 2, true);
            continue;
          }
          value += source[index];
          index += 1;
        }
        if (!hasInterpolation) add(value, "string", start, index);
        continue;
      }
      const leadingEscape =
        char === "\\" ? readIdentifierUnicodeEscape(source, index) : null;
      if (
        /[A-Za-z_$]/.test(char) ||
        (leadingEscape && /[A-Za-z_$]/.test(leadingEscape.char))
      ) {
        const start = index;
        let value;
        if (leadingEscape) {
          value = leadingEscape.char;
          index += leadingEscape.length;
        } else {
          value = char;
          index += 1;
        }
        while (index < source.length) {
          if (/[\w$]/.test(source[index])) {
            value += source[index];
            index += 1;
            continue;
          }
          const idEscape =
            source[index] === "\\"
              ? readIdentifierUnicodeEscape(source, index)
              : null;
          if (idEscape && /[\w$]/.test(idEscape.char)) {
            value += idEscape.char;
            index += idEscape.length;
            continue;
          }
          break;
        }
        add(value, "id", start, index);
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
  return { tokens, comments };
}

function matchingOpenBrace(tokens, closeIndex) {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    if (tokens[index].value === "}") depth += 1;
    else if (tokens[index].value === "{" && --depth === 0) return index;
  }
  return -1;
}

/** Accept only flat, statically named process.env destructuring properties. */
function flatDestructuredEnvNames(tokens, closeIndex) {
  const openIndex = matchingOpenBrace(tokens, closeIndex);
  if (openIndex < 0) return null;

  const names = [];
  let segment = [];
  const addSegment = () => {
    if (segment.length === 1 && segment[0].type === "id") {
      names.push(segment[0].value);
    } else if (
      segment.length === 3 &&
      segment[0].type === "id" &&
      segment[1].value === ":" &&
      segment[2].type === "id"
    ) {
      names.push(segment[0].value);
    } else {
      return false;
    }
    segment = [];
    return true;
  };

  for (let index = openIndex + 1; index < closeIndex; index += 1) {
    const token = tokens[index];
    if (token.value === ",") {
      if (segment.length > 0 && !addSegment()) return null;
      continue;
    }
    segment.push(token);
  }
  if (segment.length > 0 && !addSegment()) return null;
  return names;
}

/** Node's global object, and the browser-global spelling some isomorphic code uses. */
const GLOBAL_ROOT_NAMES = new Set(["global", "globalThis", "window"]);

function collectTokenAliases(tokens) {
  const processAliases = new Set();
  const globalThisAliases = new Set();
  const metaAliases = new Set();
  const envAliases = new Set();
  const metaEnvAliases = new Set();
  const envAliasDeclarations = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].value === "import" && tokens[i + 1]?.value !== "(") {
      let from = i + 1;
      while (from < tokens.length && tokens[from].value !== "from") {
        if (tokens[from].value === ";") break;
        from += 1;
      }
      const moduleName = tokens[from + 1]?.value;
      if (
        tokens[from]?.value === "from" &&
        ["process", "node:process"].includes(moduleName)
      ) {
        const clause = tokens.slice(i + 1, from);
        if (clause[0]?.type === "id") processAliases.add(clause[0].value);
        const namespace = clause.findIndex((token) => token.value === "*");
        if (namespace >= 0 && clause[namespace + 1]?.value === "as") {
          processAliases.add(clause[namespace + 2]?.value);
        }
        const open = clause.findIndex((token) => token.value === "{");
        let close = open < 0 ? -1 : open + 1;
        while (
          close >= 0 &&
          close < clause.length &&
          clause[close].value !== "}"
        ) {
          close += 1;
        }
        for (let j = open + 1; open >= 0 && j < close; j += 1) {
          if (clause[j].value === "env") {
            const alias = clause[j + 1]?.value === "as" ? clause[j + 2] : null;
            envAliases.add(alias?.value ?? "env");
            envAliasDeclarations.add(i + 1 + (alias ? j + 2 : j));
          }
        }
      }
    }
    const dynamicProcessImport =
      tokens[i].value === "import" &&
      tokens[i + 1]?.value === "(" &&
      ["process", "node:process"].includes(tokens[i + 2]?.value) &&
      tokens[i + 3]?.value === ")";
    if (
      dynamicProcessImport &&
      tokens[i - 1]?.value === "await" &&
      tokens[i - 2]?.value === "=" &&
      tokens[i - 3]?.type === "id"
    ) {
      processAliases.add(tokens[i - 3].value);
    }
    if (
      dynamicProcessImport &&
      tokens[i - 2]?.value === "=" &&
      tokens[i - 3]?.value === "}"
    ) {
      let open = i - 4;
      while (open >= 0 && tokens[open].value !== "{") open -= 1;
      for (let j = open + 1; open >= 0 && j < i - 3; j += 1) {
        if (tokens[j].value === "env") {
          const alias =
            tokens[j + 1]?.value === ":" ? tokens[j + 2] : tokens[j];
          envAliases.add(alias.value);
          envAliasDeclarations.add(alias === tokens[j] ? j : j + 2);
        }
      }
    }
    // D3 (issue #342 follow-up): `const p = globalThis['process'];`, `const p = (process);`
    // and `const p = require('process');` all put a live reference to the real `process`
    // object in `p`, exactly as `const p = process;` and `const p = globalThis.process;`
    // already did. Any of them followed by `.env` later is a real environment read.
    const globalDotProcessRHS =
      GLOBAL_ROOT_NAMES.has(tokens[i + 2]?.value) &&
      (tokens[i + 3]?.value === "." || tokens[i + 3]?.value === "?.") &&
      tokens[i + 4]?.value === "process";
    const globalBracketProcessRHS =
      GLOBAL_ROOT_NAMES.has(tokens[i + 2]?.value) &&
      tokens[i + 3]?.value === "[" &&
      tokens[i + 4]?.type === "string" &&
      tokens[i + 4]?.value === "process" &&
      tokens[i + 5]?.value === "]";
    const parenProcessRHS =
      tokens[i + 2]?.value === "(" &&
      tokens[i + 3]?.value === "process" &&
      tokens[i + 4]?.value === ")";
    const requireProcessRHS =
      tokens[i + 2]?.value === "require" &&
      tokens[i + 3]?.value === "(" &&
      ["process", "node:process"].includes(tokens[i + 4]?.value) &&
      tokens[i + 5]?.value === ")";
    if (
      tokens[i].type === "id" &&
      tokens[i + 1]?.value === "=" &&
      (tokens[i + 2]?.value === "process" ||
        globalDotProcessRHS ||
        globalBracketProcessRHS ||
        parenProcessRHS ||
        requireProcessRHS)
    ) {
      processAliases.add(tokens[i].value);
    }
    // D3: `const g = globalThis; g.process.env.X` — a bare alias of the global object
    // itself, resolved wherever it is later dotted into `.process`. Scoped to a plain
    // `NAME = globalThis;` statement so it cannot be confused with the alias-to-`process`
    // forms above (those require `.process`/`['process']` right there in the RHS).
    if (
      tokens[i].type === "id" &&
      tokens[i + 1]?.value === "=" &&
      GLOBAL_ROOT_NAMES.has(tokens[i + 2]?.value) &&
      tokens[i + 3]?.value === ";"
    ) {
      globalThisAliases.add(tokens[i].value);
    }
    // D3: `const m = import.meta;` then `m.env.X` — same idea, for `import.meta`.
    if (
      tokens[i].value === "meta" &&
      tokens[i - 1]?.value === "." &&
      tokens[i - 2]?.value === "import" &&
      isRootIdentifier(tokens, i - 2) &&
      tokens[i - 3]?.value === "=" &&
      tokens[i - 4]?.type === "id" &&
      tokens[i + 1]?.value === ";"
    ) {
      metaAliases.add(tokens[i - 4].value);
    }
    const destructuredFromProcess =
      (tokens[i].value === "process" &&
        ((tokens[i - 1]?.value === "=" && tokens[i - 2]?.value === "}") ||
          ((tokens[i - 1]?.value === "." || tokens[i - 1]?.value === "?.") &&
            GLOBAL_ROOT_NAMES.has(tokens[i - 2]?.value) &&
            tokens[i - 3]?.value === "=" &&
            tokens[i - 4]?.value === "}"))) ||
      (tokens[i].value === "require" &&
        tokens[i + 1]?.value === "(" &&
        ["process", "node:process"].includes(tokens[i + 2]?.value) &&
        tokens[i + 3]?.value === ")" &&
        tokens[i - 1]?.value === "=" &&
        tokens[i - 2]?.value === "}");
    if (destructuredFromProcess) {
      let open = i - 1;
      while (open >= 0 && tokens[open].value !== "{") open -= 1;
      for (let j = open + 1; open >= 0 && j < i - 1; j += 1) {
        if (tokens[j].value === "env") {
          const alias =
            tokens[j + 1]?.value === ":" ? tokens[j + 2] : tokens[j];
          envAliases.add(alias.value);
          envAliasDeclarations.add(alias === tokens[j] ? j : j + 2);
        }
      }
    }
    // D3: `const { env } = import.meta;` — the `import.meta.env` counterpart of the
    // process-destructuring case above.
    const destructuredFromImportMeta =
      tokens[i].value === "meta" &&
      tokens[i - 1]?.value === "." &&
      tokens[i - 2]?.value === "import" &&
      tokens[i - 3]?.value === "=" &&
      tokens[i - 4]?.value === "}";
    if (destructuredFromImportMeta) {
      let open = i - 4;
      while (open >= 0 && tokens[open].value !== "{") open -= 1;
      for (let j = open + 1; open >= 0 && j < i - 4; j += 1) {
        if (tokens[j].value === "env") {
          const alias =
            tokens[j + 1]?.value === ":" ? tokens[j + 2] : tokens[j];
          metaEnvAliases.add(alias.value);
          envAliasDeclarations.add(alias === tokens[j] ? j : j + 2);
        }
      }
    }
  }
  return {
    processAliases,
    globalThisAliases,
    metaAliases,
    envAliases,
    metaEnvAliases,
    envAliasDeclarations,
  };
}

function isRootIdentifier(tokens, index) {
  // A property named `process` or `globalThis` is not the Node global. In
  // particular, `options.process.env.X` must not be classified as an env read.
  return tokens[index - 1]?.value !== "." && tokens[index - 1]?.value !== "?.";
}

/**
 * Given the token index right before a possible `.env` / `?.env` / `['env']` / `?.['env']`
 * accessor, returns the end index of that accessor, or `null` if none follows. Shared by
 * every root form (`process`, an alias of it, `globalThis.process`, `import.meta`, an alias
 * of that) so each gets the same optional-chaining and computed-bracket handling once.
 */
function matchEnvAccessor(tokens, beforeIndex) {
  let accessIndex = beforeIndex + 1;
  if (tokens[accessIndex]?.value === "!") accessIndex += 1;
  const dot = tokens[accessIndex]?.value;
  if ((dot === "." || dot === "?.") && tokens[accessIndex + 1]?.value === "env")
    return accessIndex + 1;
  let bracketIndex = null;
  if (dot === "[") bracketIndex = accessIndex;
  else if (dot === "?." && tokens[accessIndex + 1]?.value === "[")
    bracketIndex = accessIndex + 1;
  if (bracketIndex === null) return null;
  if (
    tokens[bracketIndex + 1]?.value === "env" &&
    tokens[bracketIndex + 2]?.value === "]"
  )
    return bracketIndex + 2;
  const member = tokens[bracketIndex + 1];
  const close = tokens.findIndex(
    (token, tokenIndex) => tokenIndex > bracketIndex + 1 && token.value === "]",
  );
  const simpleNonEnvLiteral =
    member?.type === "string" && close === bracketIndex + 2;
  const numericIndex = /^\d+$/.test(member?.value ?? "");
  if (!simpleNonEnvLiteral && !numericIndex && close >= 0) return close;
  return null;
}

function parseEnvObject(
  tokens,
  index,
  processAliases,
  envAliases,
  globalThisAliases,
  metaAliases,
  metaEnvAliases,
) {
  const value = tokens[index]?.value;
  const rootIdentifier = isRootIdentifier(tokens, index);
  const processName =
    rootIdentifier && (value === "process" || processAliases.has(value));
  const dottedGlobalProcess =
    (GLOBAL_ROOT_NAMES.has(value) || globalThisAliases.has(value)) &&
    (tokens[index + 1]?.value === "." || tokens[index + 1]?.value === "?.") &&
    tokens[index + 2]?.value === "process";
  const computedGlobalProcess =
    (GLOBAL_ROOT_NAMES.has(value) || globalThisAliases.has(value)) &&
    tokens[index + 1]?.value === "[" &&
    tokens[index + 2]?.value === "process" &&
    tokens[index + 3]?.value === "]";
  const globalProcess =
    rootIdentifier && (dottedGlobalProcess || computedGlobalProcess);
  let processIndex = index;
  if (dottedGlobalProcess) processIndex = index + 2;
  if (computedGlobalProcess) processIndex = index + 2;
  if (processName || globalProcess) {
    let beforeAccessor = processIndex;
    if (computedGlobalProcess) beforeAccessor = index + 3;
    // D3: `(process as any).env`, `(process satisfies T).env`, `(<T>process).env` — a
    // parenthesized identifier immediately followed by `)` (the plain `(process)` case,
    // or an old-style cast `(<T>process)`), or an opening `(` right before `process` with
    // an assertion tail before the matching `)` (the `as`/`satisfies` cases). Scoped to
    // `processName` only: the global-object forms above never need unwrapping here.
    if (processName) {
      if (tokens[index + 1]?.value === ")") {
        beforeAccessor = index + 1;
      } else if (
        tokens[index - 1]?.value === "(" &&
        (tokens[index + 1]?.value === "as" ||
          tokens[index + 1]?.value === "satisfies")
      ) {
        // Only an actual TS assertion keyword right after `process` licenses scanning
        // forward for its closing paren — an arbitrary enclosing call's `(`, such as
        // `use(process!.env.X)`, must not be mistaken for a cast wrapper: its matching
        // `)` sits at the end of the whole call, far past any `.env` access.
        let depth = 1;
        for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
          if (tokens[cursor].value === "(") depth += 1;
          else if (tokens[cursor].value === ")" && --depth === 0) {
            beforeAccessor = cursor;
            break;
          }
        }
      }
    }
    const end = matchEnvAccessor(tokens, beforeAccessor);
    return end === null ? null : { object: "process.env", end };
  }
  const importMetaLiteral =
    rootIdentifier &&
    value === "import" &&
    tokens[index + 1]?.value === "." &&
    tokens[index + 2]?.value === "meta";
  const importMetaAlias = rootIdentifier && metaAliases.has(value);
  if (importMetaLiteral || importMetaAlias) {
    const metaEnd = importMetaLiteral ? index + 2 : index;
    const end = matchEnvAccessor(tokens, metaEnd);
    if (end !== null) return { object: "import.meta.env", end };
  }
  if (
    rootIdentifier &&
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
      globalThisAliases,
      metaAliases,
      metaEnvAliases,
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
    rootIdentifier &&
    value === "require" &&
    tokens[index + 1]?.value === "(" &&
    ["process", "node:process"].includes(tokens[index + 2]?.value) &&
    tokens[index + 3]?.value === ")" &&
    tokens[index + 4]?.value === "." &&
    tokens[index + 5]?.value === "env"
  ) {
    return { object: "process.env", end: index + 5 };
  }
  if (
    rootIdentifier &&
    value === "Object" &&
    tokens[index + 1]?.value === "." &&
    tokens[index + 2]?.value === "getOwnPropertyDescriptor" &&
    tokens[index + 3]?.value === "(" &&
    (tokens[index + 4]?.value === "process" ||
      processAliases.has(tokens[index + 4]?.value)) &&
    tokens[index + 5]?.value === "," &&
    tokens[index + 6]?.value === "env" &&
    tokens[index + 7]?.value === ")"
  ) {
    const valueProperty =
      tokens[index + 8]?.value === "." && tokens[index + 9]?.value === "value";
    return {
      object: "process.env",
      end: valueProperty ? index + 9 : index + 7,
    };
  }
  if (rootIdentifier && envAliases.has(value))
    return { object: "process.env", end: index };
  if (rootIdentifier && metaEnvAliases.has(value))
    return { object: "import.meta.env", end: index };
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
  const { tokens } = tokenize(source);
  const {
    processAliases,
    globalThisAliases,
    metaAliases,
    envAliases,
    metaEnvAliases,
    envAliasDeclarations,
  } = collectTokenAliases(tokens);
  const reads = [];
  const tokenAccountedStarts = new Set();
  const lines = source.split("\n");
  const addRead = (token, object, kind, name = null) => {
    tokenAccountedStarts.add(token.start);
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
      ((tokens[i - 1]?.value === "=" && tokens[i - 2]?.value === "}") ||
        ((tokens[i - 1]?.value === "." || tokens[i - 1]?.value === "?.") &&
          GLOBAL_ROOT_NAMES.has(tokens[i - 2]?.value) &&
          tokens[i - 3]?.value === "=" &&
          tokens[i - 4]?.value === "}"))
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
    // D3 (issue #342 follow-up): `import("node:process").then((m) => m.env.X)` binds its
    // result inside an arbitrary callback this detector cannot see into — unlike
    // `await import(...)`, there is no name to resolve. Fail closed on the call itself.
    if (
      tokens[i].value === "import" &&
      tokens[i + 1]?.value === "(" &&
      ["process", "node:process"].includes(tokens[i + 2]?.value) &&
      tokens[i + 3]?.value === ")" &&
      tokens[i + 4]?.value === "." &&
      tokens[i + 5]?.value === "then"
    ) {
      addRead(tokens[i], "process.env", "alias");
    }
    // D3: `with (process) { env.X }`. Strict-mode ES modules (this repository's `"type":
    // "module"`) reject `with` outright, but fail closed anyway rather than assume every
    // scanned file is one.
    if (
      tokens[i].value === "with" &&
      tokens[i + 1]?.value === "(" &&
      (tokens[i + 2]?.value === "process" ||
        processAliases.has(tokens[i + 2]?.value)) &&
      tokens[i + 3]?.value === ")"
    ) {
      addRead(tokens[i], "process.env", "alias");
    }
    const parsed = parseEnvObject(
      tokens,
      i,
      processAliases,
      envAliases,
      globalThisAliases,
      metaAliases,
      metaEnvAliases,
    );
    if (!parsed) {
      // D3: `f(process)` hands the whole object to code this detector cannot see into.
      // Narrowly scoped to the literal `process` identifier used as a bare call argument —
      // an already-tracked alias merely being passed around is not itself a new read (see
      // the "processAlias" decoy case below), and the calls this file already resolves
      // (`Reflect.get(process, "env")`, `require("process")`, `with (process)`) must not
      // be double-counted here just because `process` is also their sole/first argument.
      const precededByArgBoundary =
        tokens[i - 1]?.value === "(" || tokens[i - 1]?.value === ",";
      const followedByArgBoundary =
        tokens[i + 1]?.value === ")" || tokens[i + 1]?.value === ",";
      const calleeName =
        tokens[i - 1]?.value === "(" ? tokens[i - 2]?.value : null;
      const isRecognizedWrapperCallee =
        calleeName === "with" ||
        calleeName === "require" ||
        (calleeName === "get" &&
          tokens[i - 3]?.value === "." &&
          tokens[i - 4]?.value === "Reflect") ||
        (calleeName === "getOwnPropertyDescriptor" &&
          tokens[i - 3]?.value === "." &&
          tokens[i - 4]?.value === "Object");
      if (
        tokens[i].type === "id" &&
        tokens[i].value === "process" &&
        isRootIdentifier(tokens, i) &&
        precededByArgBoundary &&
        followedByArgBoundary &&
        !isRecognizedWrapperCallee
      ) {
        addRead(tokens[i], "process.env", "alias");
      }
      continue;
    }
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
    }

    // Only flat identifier keys can be attributed independently. Nested, computed,
    // defaulted, string-keyed, and rest patterns copy or select dynamically, so the
    // entire read stays unattributable.
    if (
      kind === "alias" &&
      tokens[parsed.end]?.value === "env" &&
      tokens[parsed.end + 1]?.value === ";"
    ) {
      const equals = tokens[i - 1]?.value === "=" ? i - 1 : -1;
      if (equals > 0 && tokens[equals - 1]?.value === "}") {
        const names = flatDestructuredEnvNames(tokens, equals - 1);
        if (!names || names.length === 0) {
          const id = `${token.start}:${parsed.object}:alias`;
          if (!seen.has(id)) {
            seen.add(id);
            addRead(token, parsed.object, "alias");
          }
          continue;
        }
        for (const name of names) {
          const id = `${token.start}:${name}`;
          if (!seen.has(id)) {
            seen.add(id);
            addRead(token, parsed.object, "named", name);
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

  // The tokenizer is intentionally small, not a TypeScript/JSX parser. In a syntax
  // position it cannot prove is a comment, a raw environment-object spelling that did
  // not produce a token-level read must fail closed. This backstop also keeps strings,
  // regex literals, and JSX text from hiding a read after a lexer misclassification.
  // No raw match is exempted. This deliberately includes comment-like JSX text and
  // any other syntax the lightweight tokenizer could misclassify.
  const rawAccess =
    /(?<![\w$.])(?:(?:globalThis|global|window)\s*(?:\.|\?\.)\s*)?process\s*(?:\.\s*env|\?\.\s*env)|(?<![\w$.])import\s*\.\s*meta\s*(?:\.\s*env|\?\.\s*env)/g;
  rawAccess.lastIndex = 0;
  for (
    let match = rawAccess.exec(source);
    match !== null;
    match = rawAccess.exec(source)
  ) {
    const start = match.index;
    // `globalThis.process.env`'s token-level read begins at `globalThis`, while this
    // spelling's backstop match begins at `process`; the preceding dot prevents a
    // second raw match for that case. All other ordinary spellings begin at the same
    // source offset as their parsed token.
    const tokenStart = source.startsWith("globalThis", start)
      ? start
      : source.startsWith("global.", start)
        ? start
        : start;
    if (tokenAccountedStarts.has(tokenStart)) continue;

    const object = /\bimport\s*\./.test(match[0])
      ? "import.meta.env"
      : "process.env";
    const line = source.slice(0, start).split("\n").length;
    reads.push({
      object,
      kind: "alias",
      name: null,
      line,
      snippet: (lines[line - 1] ?? "").trim(),
    });
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
