#!/usr/bin/env node
/**
 * check:skips — "no .skip / .only / describe.skip" (docs/04-engineering/ci-cd.md).
 *
 * Testing strategy rule 2: never disable a test to make a build pass. AGENTS.md do-not 5
 * says the same, and Definition of Done's "Any change" checklist has a box for it. This is
 * that sentence turned into something the build refuses.
 *
 * Only test files are scanned — `.skip(` is a legitimate method name elsewhere.
 */

import path from "node:path";
import {
  codeFilesUnder,
  finish,
  readText,
  rel,
  violation,
} from "./lib/repo.mjs";

const NAME = "check:skips";

const roots = ["apps", "packages", "tests"];

const banned = [
  {
    pattern: /\b(?:describe|it|test|suite|bench)\s*\.\s*skip\s*[(.]/g,
    why: ".skip",
  },
  {
    pattern: /\b(?:describe|it|test|suite|bench)\s*\.\s*only\s*[(.]/g,
    why: ".only",
  },
  {
    pattern:
      /\b(?:describe|it|test)\s*\.\s*(?:concurrent|sequential|each)\s*\.\s*(?:skip|only)\b/g,
    why: "chained .skip / .only",
  },
  { pattern: /\bx(?:describe|it|test)\s*\(/g, why: "xdescribe / xit / xtest" },
  { pattern: /\bf(?:describe|it|test)\s*\(/g, why: "fdescribe / fit / ftest" },
  { pattern: /\bctx\s*\.\s*skip\s*\(/g, why: "context.skip()" },
];

function isTestFile(relativePath) {
  const base = path.basename(relativePath);
  return (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(base) ||
    relativePath.startsWith("tests/") ||
    /(?:^|\/)(?:e2e|playwright)\//.test(relativePath)
  );
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

async function main() {
  const files = (await codeFilesUnder(roots)).filter((absolute) =>
    isTestFile(rel(absolute)),
  );
  const failures = [];

  for (const absolute of files) {
    const source = await readText(absolute);
    for (const { pattern, why } of banned) {
      pattern.lastIndex = 0;
      for (
        let match = pattern.exec(source);
        match !== null;
        match = pattern.exec(source)
      ) {
        const line = lineOf(source, match.index);
        failures.push(
          violation(
            `${rel(absolute)}:${line}`,
            `${why} — ${match[0].trim()}. Never disable a test to make a build pass ` +
              "(AGENTS.md do-not 5). Fix it or revert the change.",
          ),
        );
      }
    }
  }

  finish({
    name: NAME,
    failures,
    ok: `${files.length} test file(s), none skipped or focused`,
  });
}

await main();
