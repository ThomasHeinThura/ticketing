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

const ACCESS =
  /(?<![\w$.])(process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env)(?![\w$])/g;

const NAMED = /^\s*\??\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/;
const BRACKET_LITERAL = /^\s*\??\.?\[\s*(["'])((?:[^"'\\]|\\.)*)\1\s*\]/;
const BRACKET_COMPUTED = /^\s*\??\.?\[/;

/** `import.meta.env` members Vite defines itself; they are not deployment configuration. */
export const viteBuiltIns = new Set([
  "MODE",
  "DEV",
  "PROD",
  "SSR",
  "BASE_URL",
  "LEGACY",
]);

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

/**
 * Walk backwards from an `=` to the `{` that opens the destructuring pattern before it,
 * so `const { SMTP_HOST, SMTP_PORT } = process.env` resolves to two named reads.
 *
 * @returns {string[] | null} the destructured keys, or null when this is not a pattern
 */
function destructuredKeys(source, equalsIndex) {
  let i = equalsIndex - 1;
  while (i >= 0 && /\s/.test(source[i])) {
    i -= 1;
  }
  if (i < 0 || source[i] !== "}") {
    return null;
  }

  let depth = 0;
  const end = i;
  while (i >= 0) {
    const char = source[i];
    if (char === "}") {
      depth += 1;
    } else if (char === "{") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    i -= 1;
  }
  if (i < 0) {
    return null;
  }

  const body = source.slice(i + 1, end);
  if (body.includes("...")) {
    return null;
  }

  const keys = [];
  for (const part of body.split(",")) {
    const key = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(part);
    if (!key) {
      if (part.trim() !== "") {
        return null;
      }
      continue;
    }
    keys.push(key[1]);
  }
  return keys.length > 0 ? keys : null;
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
  const reads = [];
  ACCESS.lastIndex = 0;

  for (
    let match = ACCESS.exec(source);
    match !== null;
    match = ACCESS.exec(source)
  ) {
    const object =
      match[1].replace(/\s+/g, "") === "process.env"
        ? "process.env"
        : "import.meta.env";
    const start = match.index;
    const end = start + match[0].length;
    const after = source.slice(end, end + 200);
    const line = lineOf(source, start);
    const snippet = (source.split("\n")[line - 1] ?? "").trim();
    const base = { object, line, snippet };

    const named = NAMED.exec(after);
    if (named) {
      reads.push({ ...base, kind: "named", name: named[1] });
      continue;
    }

    const literal = BRACKET_LITERAL.exec(after);
    if (literal) {
      reads.push({ ...base, kind: "named", name: literal[2] });
      continue;
    }

    if (BRACKET_COMPUTED.test(after)) {
      reads.push({ ...base, kind: "computed", name: null });
      continue;
    }

    let before = start - 1;
    while (before >= 0 && /\s/.test(source[before])) {
      before -= 1;
    }
    if (
      before >= 0 &&
      source[before] === "=" &&
      source[before - 1] !== "=" &&
      source[before - 1] !== "!"
    ) {
      const keys = destructuredKeys(source, before);
      if (keys) {
        for (const key of keys) {
          reads.push({ ...base, kind: "named", name: key });
        }
        continue;
      }
    }

    reads.push({ ...base, kind: "alias", name: null });
  }

  return reads;
}
