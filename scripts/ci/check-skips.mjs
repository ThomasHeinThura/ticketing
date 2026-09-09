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
import { stripCodeComments } from "./lib/strip-code-comments.mjs";
import { readWorkspaceRoots } from "./lib/workspace-membership.mjs";

const NAME = "check:skips";

// M3: `scripts/ci` was NOT scanned, so a skipped gate checker or red probe was
// invisible — the machinery that proves the other gates work could be switched off
// without this gate noticing. Reproduced: `it.skip` on a shipped red probe left
// check:skips at "161 test file(s), none skipped or focused", exit 0.
//
// `isTestFile` below is what keeps this narrow: only *.test.mjs / *.spec.* files and
// anything under tests/ are read, so ordinary scripts and their comments are never
// scanned and cannot false-positive.
//
// A5's class, here: `roots` was a literal `["apps", "packages", "tests", "scripts/ci"]`.
// The workspace half is now DERIVED from pnpm-workspace.yaml, so adding `tools/**` to the
// workspace cannot leave this gate quietly not scanning it, and `scripts/ci` is widened
// to `scripts` so a skipped test under `scripts/i18n` is covered too. `tests` and
// `scripts` are named explicitly because neither is a workspace package — this gate wants
// them, and saying so is the point.
async function scanRoots() {
  return [...(await readWorkspaceRoots()), "tests", "scripts"];
}

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
  const files = (await codeFilesUnder(await scanRoots())).filter((absolute) =>
    isTestFile(rel(absolute)),
  );
  const failures = [];

  for (const absolute of files) {
    // M3: scan CODE, not prose or test data. Comments and string/template contents are
    // blanked first — a doc comment explaining `.skip` and a probe asserting on its text
    // are both documentation, not disabled tests, and blocking them enforces nothing. A
    // genuinely skipped test cannot hide in either and still execute. Line numbers are
    // preserved by the scanner so the reported location is still the real one.
    const source = stripCodeComments(await readText(absolute), {
      blankStrings: true,
    });
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
