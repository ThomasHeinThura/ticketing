import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_WRITERS, AUDITED_ROUTES } from "./audited-routes.manifest";

/**
 * How this guards the "audited write whose web mutation lacks `meta.audits`" class. Everything is
 * grep-based, so it needs no database and no running app:
 *
 * - API side, anchored on the writers. A writer is a non-test file under `apps/api/src` that names
 *   an action from `history-actions.ts` as a quoted literal. Every (file, action) pair must be
 *   claimed by a manifest route or writer entry, and every claim must still be true, so a new
 *   audited write, or a removed one, fails here. Routes are matched by `operationId` text (and
 *   HTTP method), which avoids resolving mount prefixes. `audit/` (readers), `events/` and
 *   `notification/` (registries and event contracts) and `webhook/constants.ts` name actions
 *   without writing them and are skipped.
 * - Web side, anchored on the callers. Every file that imports an audited fetcher function must be
 *   listed as a mutation file, and every `useMutation({ ... })` block in it that mentions the
 *   function must declare `audits:`; a call outside any such block fails too. Known limit: a
 *   mutation function defined outside the block and passed by name is not seen by the block check.
 */
const WEB = join(import.meta.dirname, "..");
const API = join(WEB, "../../api/src");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const texts = new Map<string, string>();
const read = (path: string) => {
  const cached = texts.get(path);
  if (cached !== undefined) return cached;
  const text = readFileSync(path, "utf8");
  texts.set(path, text);
  return text;
};
const isSource = (file: string) =>
  /\.tsx?$/.test(file) && !/\.test(-helper)?\.tsx?$/.test(file);

const HISTORY = new Set(
  [
    ...read(join(API, "audit/history-actions.ts")).matchAll(
      /"([a-z_]+\.[a-z_]+)"/g,
    ),
  ].map((match) => match[1] as string),
);
const apiFiles = walk(API)
  .map((file) => relative(API, file))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
const NAMES_WITHOUT_WRITING =
  /^(audit\/(?!notification-settings\.ts$)|events\/|notification\/|webhook\/constants\.ts$)/;
const writtenPairs = apiFiles
  .filter((file) => !NAMES_WITHOUT_WRITING.test(file))
  .flatMap((file) => {
    const text = read(join(API, file));
    return [...HISTORY]
      .filter((action) => text.includes(`"${action}"`))
      .map((action) => ({ file, action }));
  });

const claims = [
  ...AUDITED_ROUTES.map((entry) => ({
    producers: entry.producers ?? [entry.api],
    actions: entry.actions,
  })),
  ...AUDIT_WRITERS,
];

describe("audited API writes", () => {
  it("claims every action an API file writes", () => {
    const unclaimed = writtenPairs.filter(
      ({ file, action }) =>
        !claims.some(
          (claim) =>
            claim.producers.includes(file) && claim.actions.includes(action),
        ),
    );
    expect(unclaimed).toEqual([]);
  });

  it("only claims actions that exist, are in History and are still written", () => {
    const stale = claims.flatMap((claim) => [
      ...claim.actions
        .filter(
          (action) =>
            !HISTORY.has(action) ||
            !claim.producers.some((file) =>
              existsSync(join(API, file))
                ? read(join(API, file)).includes(`"${action}"`)
                : false,
            ),
        )
        .map((action) => `${action} is not written by ${claim.producers}`),
      ...claim.producers
        .filter(
          (file) =>
            !existsSync(join(API, file)) ||
            !claim.actions.some((action) =>
              read(join(API, file)).includes(`"${action}"`),
            ),
        )
        .map((file) => `${file} writes none of ${claim.actions}`),
    ]);
    expect(stale).toEqual([]);
  });

  it("lists routes that still exist with the same method", () => {
    const missing = AUDITED_ROUTES.flatMap((entry) => {
      const file = join(API, entry.api);
      if (!existsSync(file)) return [`${entry.api} is gone`];
      const text = read(file);
      const at = Math.max(
        text.indexOf(`operationId: "${entry.op}"`),
        text.indexOf(`"${entry.op}"`),
      );
      if (at < 0) return [`${entry.route}: ${entry.op} not in ${entry.api}`];
      const start = text.lastIndexOf("createRoute(", at);
      const block = text.slice(start, text.indexOf("\n});", at));
      const method = block.match(/method:\s*"(\w+)"/)?.[1]?.toUpperCase();
      return method && method !== entry.route.split(" ")[0]
        ? [`${entry.op} is ${method}, manifest says ${entry.route}`]
        : [];
    });
    expect(missing).toEqual([]);
  });
});

const mutationFiles = new Set([
  ...AUDITED_ROUTES.flatMap((entry) => entry.mutations),
  ...AUDIT_WRITERS.flatMap((writer) => writer.mutations ?? []),
]);
const exempt = new Set(
  AUDITED_ROUTES.filter((entry) => entry.noTarget).flatMap(
    (entry) => entry.mutations,
  ),
);
const targeted = [...mutationFiles].filter((file) => !exempt.has(file));

/** `meta: byId` style references count; a `// no-audits: reason` comment opts a block out. */
const hasAudits = (block: string) =>
  /\baudits\s*:|\bmeta:\s*[A-Za-z_]|no-audits:/.test(block);

/** The body of every `useMutation(...)` call, by balanced parentheses. */
function mutationBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const match of text.matchAll(/\buseMutation\s*[<(]/g)) {
    const open = text.indexOf("(", match.index);
    let depth = 0;
    let quote = "";
    for (let at = open; at < text.length; at++) {
      const char = text[at] as string;
      if (quote) {
        if (char === "\\") at++;
        else if (char === quote) quote = "";
      } else if (char === "/" && text[at + 1] === "/") {
        at = text.indexOf("\n", at);
        if (at < 0) break;
      } else if (char === "/" && text[at + 1] === "*") {
        at = text.indexOf("*/", at) + 1;
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "(") depth++;
      else if (char === ")" && --depth === 0) {
        blocks.push(text.slice(open, at + 1));
        break;
      }
    }
  }
  return blocks;
}

/** Local names under which `file` imports `fn` from the fetcher module at `fetcher`. */
function importedAs(file: string, text: string, fetcher: string, fn: string) {
  const target = join(WEB, fetcher.replace(/\.ts$/, ""));
  const names: string[] = [];
  for (const match of text.matchAll(
    /import\s+(type\s+)?([^;]*?)\s+from\s+"([^"]+)"/gs,
  )) {
    if (match[1]) continue;
    const spec = match[3] as string;
    const path = spec.startsWith("@/")
      ? join(WEB, spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(file), spec)
        : "";
    if (path !== target && path !== join(target, "..")) continue;
    if (path === join(target, "..") && !target.endsWith("/index")) continue;
    const clause = match[2] as string;
    if (fn === "default") {
      const local = clause.match(/^(\w+)/)?.[1];
      if (local && !clause.startsWith("{")) names.push(local);
    } else {
      for (const part of clause.match(/\{([^}]*)\}/s)?.[1]?.split(",") ?? []) {
        const [name, alias] = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/);
        if (name === fn && !part.trim().startsWith("type "))
          names.push(alias ?? name);
      }
    }
  }
  return names;
}

describe("audited web mutations", () => {
  it("lists a web caller or a reason for none", () => {
    expect(
      AUDITED_ROUTES.filter(
        (entry) => entry.mutations.length === 0 && !entry.noWeb,
      ).map((entry) => entry.route),
    ).toEqual([]);
  });

  it.each(AUDITED_ROUTES.flatMap((entry) => entry.fetchers))(
    "%s exists and exports the function",
    (spec) => {
      const [file, fn] = spec.split("#") as [string, string];
      expect(existsSync(join(WEB, file))).toBe(true);
      const text = read(join(WEB, file));
      expect(text).toMatch(
        fn === "default"
          ? /export\s+default\b/
          : new RegExp(
              `export\\s+(?:async\\s+)?(?:function\\s+|const\\s+)${fn}\\b`,
            ),
      );
    },
  );

  it.each(targeted)("%s declares meta.audits", (file) => {
    expect(read(join(WEB, file))).toMatch(/audits:\s*\{|audits:\s*\w/);
  });

  it("lists every caller of an audited fetcher, and each useMutation in them declares audits", () => {
    const sources = walk(WEB).filter(isSource);
    const problems: string[] = [];
    const fetchers = new Set(AUDITED_ROUTES.flatMap((entry) => entry.fetchers));
    for (const spec of fetchers) {
      const [fetcher, fn] = spec.split("#") as [string, string];
      for (const file of sources) {
        const rel = relative(WEB, file);
        if (rel === fetcher || rel.startsWith("fetchers/")) continue;
        const text = read(file);
        if (fn !== "default" && !text.includes(fn)) continue;
        const locals = importedAs(file, text, fetcher, fn);
        if (locals.length === 0) continue;
        if (!mutationFiles.has(rel)) {
          problems.push(`${rel} calls ${spec} but is not in the manifest`);
          continue;
        }
        if (exempt.has(rel)) continue;
        const mention = new RegExp(`\\b(${locals.join("|")})\\b`);
        const all = mutationBlocks(text);
        // A wrapper hook or a function chosen by name is not visible in the block, so then every block must audit.
        const named = all.filter((block) => mention.test(block));
        const blocks = named.length > 0 ? named : all;
        if (blocks.length === 0)
          problems.push(`${rel} uses ${spec} outside a useMutation block`);
        for (const block of blocks)
          if (!hasAudits(block))
            problems.push(
              `${rel} has a useMutation for ${spec} without audits`,
            );
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it("only the History controller imports the raw History fetchers", () => {
    const allowed = new Set([
      "components/settings/settings-history.tsx", // type-only import
      "hooks/queries/settings/use-settings-history.ts",
      "query-client/settings-history-key.ts",
    ]);
    const offenders = walk(WEB)
      .filter(isSource)
      .map((file) => relative(WEB, file))
      .filter((file) => !allowed.has(file))
      .filter((file) =>
        /fetchers\/settings\/(settings|personal)-history"/.test(
          read(join(WEB, file)),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
