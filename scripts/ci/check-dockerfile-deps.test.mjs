/**
 * check:dockerfile-deps — unit tests for the pure `deps`-stage parsing functions.
 *
 * Security review, PR #237 (docs/07-planning/security-reviews/170-dockerfile-deps-drift-
 * check.md): F1, F2 and F4 are BLOCKING; F3 and F5 are the recommended fixes that closed
 * alongside them. These tests exercise `extractDepsStage` and `copiedManifests` directly
 * against fixture Dockerfile strings built inline here — never the real repo `Dockerfile` —
 * so a future edit to the real file cannot make this suite pass or fail for the wrong
 * reason. Each RED case is paired with a GREEN one wherever that is meaningful, so a probe
 * that always fails (or a checker gutted to always pass) cannot hide here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCopyManifestPattern,
  copiedManifests,
  DEFAULT_WORKSPACE_ROOTS,
  extractDepsStage,
} from "./check-dockerfile-deps.mjs";

/** A minimal but realistic multi-stage Dockerfile, with the `deps` stage's own lines given. */
function dockerfile(depsLines) {
  return [
    "ARG NODE_IMAGE=node:24.20.0-bookworm-slim",
    "",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture SOURCE TEXT mirroring the real Dockerfile's `${NODE_IMAGE}` ARG substitution, not a template literal here
    "FROM ${NODE_IMAGE} AS base",
    "WORKDIR /repo",
    "",
    "FROM base AS deps",
    ...depsLines,
    "",
    "FROM deps AS build",
    "COPY . .",
    "RUN pnpm turbo build",
    "",
  ].join("\n");
}

const ROOT_BOOTSTRAP =
  "COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./";

const HAPPY_DEPS_LINES = [
  ROOT_BOOTSTRAP,
  "COPY packages/domain/package.json packages/domain/",
  "COPY packages/ui/package.json packages/ui/",
  "RUN pnpm install --frozen-lockfile",
];

const EXPECTED_MANIFESTS = new Set([
  "packages/domain/package.json",
  "packages/ui/package.json",
]);

function extractAndCopy(source, roots = DEFAULT_WORKSPACE_ROOTS) {
  return copiedManifests(extractDepsStage(source), roots);
}

describe("check:dockerfile-deps — the correct shape", () => {
  it("a correct deps stage: no missing, no extra", () => {
    const copied = extractAndCopy(dockerfile(HAPPY_DEPS_LINES));
    assert.deepEqual(copied, EXPECTED_MANIFESTS);

    const missing = [...EXPECTED_MANIFESTS].filter((m) => !copied.has(m));
    const extra = [...copied].filter((m) => !EXPECTED_MANIFESTS.has(m));
    assert.deepEqual(missing, []);
    assert.deepEqual(extra, []);
  });

  it("the root-manifest bootstrap COPY is recognized and does not itself count as a per-package manifest", () => {
    const copied = extractAndCopy(dockerfile(HAPPY_DEPS_LINES));
    assert.equal(copied.has("package.json"), false);
    assert.equal(copied.size, 2);
  });
});

describe("check:dockerfile-deps — a missing COPY line is reported", () => {
  it("omitting a package's COPY line leaves it out of copiedManifests, so a missing-diff would report it", () => {
    const linesWithoutUi = [
      ROOT_BOOTSTRAP,
      "COPY packages/domain/package.json packages/domain/",
      "RUN pnpm install --frozen-lockfile",
    ];
    const copied = extractAndCopy(dockerfile(linesWithoutUi));

    const missing = [...EXPECTED_MANIFESTS].filter((m) => !copied.has(m));
    assert.deepEqual(missing, ["packages/ui/package.json"]);
  });
});

describe("check:dockerfile-deps — a stale/extra COPY line is reported", () => {
  it("a COPY line for a package outside the expected set shows up as extra", () => {
    const linesWithGhost = [
      ...HAPPY_DEPS_LINES,
      "COPY packages/ghostpkg/package.json packages/ghostpkg/",
    ];
    const copied = extractAndCopy(dockerfile(linesWithGhost));

    const extra = [...copied].filter((m) => !EXPECTED_MANIFESTS.has(m));
    assert.deepEqual(extra, ["packages/ghostpkg/package.json"]);
  });
});

describe("check:dockerfile-deps — F1: a mismatched source/destination directory does not satisfy the manifest", () => {
  it("COPY packages/domain/package.json packages/ui/ does not count as domain being copied", () => {
    const linesWithMisdirectedCopy = [
      ROOT_BOOTSTRAP,
      // Same shape a human would produce by copy-pasting the line above and editing only
      // the first path — the exact probe from the security review.
      "COPY packages/domain/package.json packages/ui/",
      "COPY packages/ui/package.json packages/ui/",
      "RUN pnpm install --frozen-lockfile",
    ];
    const stageLines = extractDepsStage(dockerfile(linesWithMisdirectedCopy));

    // F3's hard-failure path also catches this shape (it mentions `package.json` but
    // matches neither the anchored per-package pattern nor the root bootstrap), so the
    // observable effect is a thrown error rather than a silently-accepted manifest. Either
    // way, the requirement is met: `packages/domain/package.json` never enters the
    // returned set as "copied".
    assert.throws(
      () => copiedManifests(stageLines),
      /packages\/domain\/package\.json packages\/ui\//,
    );

    // Non-vacuity: confirm the *only* difference from the happy path is this one line, by
    // showing the happy path (same lines, correct destination) does NOT throw and DOES
    // count domain as copied.
    const corrected = extractAndCopy(dockerfile(HAPPY_DEPS_LINES));
    assert.equal(corrected.has("packages/domain/package.json"), true);
  });

  it("the anchored pattern rejects the destination directly (buildCopyManifestPattern)", () => {
    const pattern = buildCopyManifestPattern(["packages", "apps"]);
    assert.equal(
      pattern.test("COPY packages/domain/package.json packages/ui/"),
      false,
    );
    assert.equal(
      pattern.test("COPY packages/domain/package.json packages/domain/"),
      true,
    );
  });
});

describe("check:dockerfile-deps — F2: an un-named FROM still ends the deps stage boundary", () => {
  it("FROM deps (no AS) ends the stage, so a COPY after it is not counted as part of deps", () => {
    const source = [
      "FROM base AS deps",
      ROOT_BOOTSTRAP,
      "COPY packages/ui/package.json packages/ui/",
      // Un-named intermediate stage — ordinary, and what F2 demonstrated as invisible.
      "FROM deps",
      "COPY packages/domain/package.json packages/domain/",
      "FROM deps AS build",
      "COPY . .",
      "",
    ].join("\n");

    const stageLines = extractDepsStage(source);
    assert.equal(
      stageLines.some((line) => line.includes("packages/domain")),
      false,
      "the domain COPY line, which sits after the un-named FROM, must not be part of the extracted deps stage",
    );

    const copied = copiedManifests(stageLines);
    assert.equal(copied.has("packages/domain/package.json"), false);
    assert.equal(copied.has("packages/ui/package.json"), true);
  });

  it("PAIRED: naming that same intermediate stage still ends the boundary at the first FROM either way", () => {
    const source = [
      "FROM base AS deps",
      ROOT_BOOTSTRAP,
      "COPY packages/ui/package.json packages/ui/",
      "FROM deps AS intermediate",
      "COPY packages/domain/package.json packages/domain/",
      "FROM deps AS build",
      "COPY . .",
      "",
    ].join("\n");

    const copied = copiedManifests(extractDepsStage(source));
    assert.equal(copied.has("packages/domain/package.json"), false);
    assert.equal(copied.has("packages/ui/package.json"), true);
  });

  it("the deps stage's own `FROM base AS deps` line is not mistaken for a later boundary on the same pass", () => {
    // Regression guard for the loop shape: ANY_STAGE is only tested once `start` is set, so
    // the stage's own opening line (matched by STAGE_START) cannot also end it immediately.
    const stageLines = extractDepsStage(dockerfile(HAPPY_DEPS_LINES));
    assert.equal(stageLines[0], "FROM base AS deps");
    assert.ok(stageLines.length > 1);
  });
});

describe("check:dockerfile-deps — F3: an unclassifiable line inside the stage hard-fails rather than passing silently", () => {
  it("a heredoc body containing a line that looks like a valid COPY is a hard failure, not a silent match", () => {
    const linesWithHeredoc = [
      ROOT_BOOTSTRAP,
      "COPY packages/ui/package.json packages/ui/",
      "RUN cat <<EOF > /tmp/notes",
      "COPY packages/domain/package.json packages/domain/",
      "EOF",
    ];
    const stageLines = extractDepsStage(dockerfile(linesWithHeredoc));

    assert.throws(() => copiedManifests(stageLines), /inside a heredoc/);
  });

  it("PAIRED: the same content as a real top-level COPY line (not inside a heredoc) passes cleanly", () => {
    const copied = extractAndCopy(dockerfile(HAPPY_DEPS_LINES));
    assert.equal(copied.has("packages/domain/package.json"), true);
  });

  it("a malformed COPY line outside any heredoc still hard-fails with the malformed-line message", () => {
    const lines = [
      ROOT_BOOTSTRAP,
      "COPY packages/domain/package.json packages/domain/",
      "COPY --from=base packages/ui/package.json packages/ui/",
      "RUN pnpm install --frozen-lockfile",
    ];
    assert.throws(
      () => extractAndCopy(dockerfile(lines)),
      /not a recognized .*COPY.*line/,
    );
  });

  it("an unclosed heredoc at the end of the stage hard-fails rather than being silently dropped", () => {
    // The heredoc opener is the LAST line of the deps stage — no body line, and no blank
    // line, follows it before the next `FROM` ends the stage — so the "inside a heredoc"
    // per-line check never fires and the dedicated end-of-stage guard must catch it instead.
    // Built directly (not via the shared `dockerfile()` helper, which inserts a blank line
    // after the deps lines) so the heredoc opener is truly the stage's last line.
    const source = [
      "FROM base AS deps",
      ROOT_BOOTSTRAP,
      "COPY packages/domain/package.json packages/domain/",
      "COPY packages/ui/package.json packages/ui/",
      "RUN cat <<EOF > /tmp/notes",
      "FROM deps AS build",
      "COPY . .",
      "",
    ].join("\n");
    assert.throws(() => extractAndCopy(source), /never closed/);
  });

  it("blank lines and comment lines inside the stage are not treated as unclassifiable", () => {
    const linesWithCommentsAndBlanks = [
      ROOT_BOOTSTRAP,
      "",
      "# per-package manifests, one line per workspace package",
      "COPY packages/domain/package.json packages/domain/",
      "COPY packages/ui/package.json packages/ui/",
      "",
      "RUN pnpm install --frozen-lockfile",
    ];
    const copied = extractAndCopy(dockerfile(linesWithCommentsAndBlanks));
    assert.deepEqual(copied, EXPECTED_MANIFESTS);
  });
});

describe("check:dockerfile-deps — F5: the accepted COPY-path prefixes are derived from workspace roots, not hardcoded", () => {
  it("a workspace root outside packages/apps (e.g. tools/**) is recognized when passed explicitly", () => {
    const lines = [
      ROOT_BOOTSTRAP,
      "COPY tools/scaffold/package.json tools/scaffold/",
      "RUN pnpm install --frozen-lockfile",
    ];
    const copied = extractAndCopy(dockerfile(lines), [
      "packages",
      "apps",
      "tools",
    ]);
    assert.equal(copied.has("tools/scaffold/package.json"), true);
  });

  it("PAIRED: the same line, with roots restricted to packages/apps only, is not recognized as a per-package manifest and hard-fails", () => {
    const lines = [
      ROOT_BOOTSTRAP,
      "COPY tools/scaffold/package.json tools/scaffold/",
      "RUN pnpm install --frozen-lockfile",
    ];
    assert.throws(
      () => extractAndCopy(dockerfile(lines), ["packages", "apps"]),
      /cannot classify it/,
    );
  });
});

describe("check:dockerfile-deps — extractDepsStage itself", () => {
  it("throws when no `FROM ... AS deps` stage exists at all", () => {
    const source = ["FROM node:24 AS base", "RUN echo hi", ""].join("\n");
    assert.throws(
      () => extractDepsStage(source),
      /No `FROM \.\.\. AS deps` stage/,
    );
  });

  it("a case-different stage name (`AS Deps`) is still found", () => {
    const source = dockerfile(HAPPY_DEPS_LINES).replace(
      "FROM base AS deps",
      "FROM base AS Deps",
    );
    const stageLines = extractDepsStage(source);
    assert.equal(stageLines[0], "FROM base AS Deps");
  });

  it("the deps stage runs to end of file when it is the last stage", () => {
    const source = ["FROM base AS deps", ...HAPPY_DEPS_LINES, ""].join("\n");
    const stageLines = extractDepsStage(source);
    assert.equal(stageLines.at(-1), "");
    assert.ok(stageLines.includes("RUN pnpm install --frozen-lockfile"));
  });
});
