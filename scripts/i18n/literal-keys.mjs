import fs from "node:fs/promises";
import path from "node:path";

/**
 * Every literal `t("ns:key")` (or `t("key")` under the file's `useTranslation` namespaces) in the
 * web app must exist in the reference locale. A `defaultValue` does not count: it shows English in
 * every other language. Template-literal keys, `i18n.t`/`instance.t` and calls passing `ns:` are
 * out of scope; they cannot be resolved statically.
 */

const SOURCE_DIRS = ["apps/web/src", "apps/web/portal"];
const SKIP_FILE = /\.(test|spec|stories)\.tsx?$|\.gen\.ts$|\.d\.ts$/u;
const DEFAULT_NAMESPACE = "common";
const PLURAL_SUFFIXES = [
  "",
  "_zero",
  "_one",
  "_two",
  "_few",
  "_many",
  "_other",
];

async function sourceFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "test") continue;
      files.push(...(await sourceFiles(full)));
    } else if (/\.tsx?$/u.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function valueAt(reference, namespace, key) {
  let node = reference[namespace];
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, part)) {
      return undefined;
    }
    node = node[part];
  }
  return node;
}

function keyExists(reference, namespace, key) {
  return PLURAL_SUFFIXES.some(
    (suffix) =>
      typeof valueAt(reference, namespace, `${key}${suffix}`) === "string",
  );
}

/** The text of a call's arguments, from its opening parenthesis to the matching close. */
function callArguments(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return source.slice(openIndex + 1);
}

/** Namespaces the file's `useTranslation` calls bring into scope for unprefixed keys. */
export function fileNamespaces(source) {
  const namespaces = new Set();
  for (const match of source.matchAll(/useTranslation\(([^)]*)\)/gu)) {
    const argument = match[1].trim();
    if (!argument) {
      namespaces.add(DEFAULT_NAMESPACE);
      continue;
    }
    const literals = [...argument.matchAll(/["'`](\w+)["'`]/gu)];
    if (literals.length === 0) namespaces.add(DEFAULT_NAMESPACE);
    for (const literal of literals) namespaces.add(literal[1]);
  }
  return namespaces;
}

/** Missing literal keys in one source file, as `{ line, key }`. */
export function missingKeysInSource(source, reference) {
  const namespaces = fileNamespaces(source);
  const missing = [];
  const pattern = /(?<![\w.$])t\(\s*(["'])([A-Za-z][\w.:-]*)\1\s*[,)]/gu;
  for (const match of source.matchAll(pattern)) {
    const literal = match[2];
    const openIndex = match.index + match[0].indexOf("(");
    if (/\bns\s*:/u.test(callArguments(source, openIndex))) continue;
    let candidates;
    let key = literal;
    const separator = literal.indexOf(":");
    if (separator > 0) {
      const namespace = literal.slice(0, separator);
      if (!Object.hasOwn(reference, namespace)) {
        missing.push({ index: match.index, key: literal });
        continue;
      }
      candidates = [namespace];
      key = literal.slice(separator + 1);
    } else {
      // A bare `t` handed in from elsewhere has no namespace this file can see.
      if (namespaces.size === 0) continue;
      candidates = [...namespaces];
    }
    if (!candidates.some((namespace) => keyExists(reference, namespace, key))) {
      missing.push({
        index: match.index,
        key: separator > 0 ? literal : `${candidates.join("|")}:${key}`,
      });
    }
  }
  return missing.map(({ index, key }) => ({
    line: source.slice(0, index).split("\n").length,
    key,
  }));
}

/** Every missing literal key in the web app, as `path:line key` strings. */
export async function findMissingLiteralKeys(repoRoot, reference) {
  const problems = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of await sourceFiles(path.join(repoRoot, dir))) {
      const source = await fs.readFile(file, "utf8");
      for (const { line, key } of missingKeysInSource(source, reference)) {
        problems.push(`${path.relative(repoRoot, file)}:${line} ${key}`);
      }
    }
  }
  return problems.sort();
}
