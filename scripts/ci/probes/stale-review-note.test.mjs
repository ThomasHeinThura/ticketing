/**
 * GPT-F2 red probe — a committed security-review note must go stale when code lands
 * after the head it reviewed.
 *
 * The full H1 → H2 → H3 chain is constructed and the checker is run at each head, so the
 * probe proves both directions: the legitimate shape passes, and the stale shape does
 * not. A probe that only asserted the failure could be satisfied by a check that
 * rejected everything.
 *
 *   H1  apps/api/src/auth.ts changed            the reviewed head
 *   H2  the note, and nothing else               PASS — this is the agreed model
 *   H3  apps/api/src/auth.ts changed again       FAIL — the reviewer never read it
 *   H4  the note gains **Reviewed head:** H3     PASS — a fresh delta review, recorded
 *
 * Non-vacuity is asserted at H3 by evaluating the OLD predicate in the same repository:
 * the note file still exists and **Model:** still reads Opus, so the pre-fix check —
 * which verified exactly those two things — would have exited 0.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, describe, it } from "node:test";
import { repoRoot } from "../lib/repo.mjs";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  evaluateInRepo,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  setOriginMain,
  write,
} from "../lib/scratch-repo.mjs";
import { attestedHeads, reviewBinding } from "../lib/security-review-note.mjs";

after(cleanUpScratchRepos);

const NOTE_PATH = "docs/07-planning/security-reviews/19-probe.md";

/** A ci-cd.md whose block covers the application surface this probe edits. */
const CI_CD = [
  "# CI/CD",
  "",
  "```",
  "│ pnpm install --frozen-lockfile                   │",
  "```",
  "",
  "```",
  "│ pnpm test:integration                            │",
  "```",
  "",
  "CI checks it non-empty, naming Opus, whenever the diff touches **any** of:",
  "",
  "```",
  "apps/api/src/auth*                   packages/permissions/**",
  "apps/api/src/middleware/**           packages/plugins-contracts/**",
  "apps/api/src/plugins/**              apps/api/src/scim/**",
  "apps/api/src/webhooks/**             apps/api/src/storage/**",
  "scripts/ci/**                        docs/04-engineering/ci-cd.md",
  "```",
  "",
].join("\n");

function note(heads, extra = "") {
  return [
    "# Pre-merge security review — PR #19 (probe)",
    "",
    ...heads.map((sha) => `**Reviewed head:** \`${sha}\``),
    "",
    "**Verdict:** CLEAR at each head above.",
    extra,
    "",
  ].join("\n");
}

function bodyWithNote() {
  return bodyFile(
    completeBody({ securityModel: "Opus 5", securityNote: NOTE_PATH }),
  );
}

/** main + H1 (the reviewed code head). */
function reviewedScenario() {
  const dir = scratchDir("stale-note");
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, ".github/pull_request_template.md");
  write(dir, "docs/04-engineering/ci-cd.md", CI_CD);
  write(dir, "apps/api/src/auth.ts", "export const secret = 1;\n");
  const base = commit(dir, "chore: bootstrap");
  setOriginMain(dir, base);

  write(dir, "apps/api/src/auth.ts", "export const secret = 2;\n");
  const h1 = commit(dir, "feat: change the auth surface");
  return { dir, base, h1 };
}

describe("GPT-F2 — the committed note is bound to the code it reviewed", () => {
  it("passes at the note-only head, and fails once code lands after it", () => {
    const { dir, h1 } = reviewedScenario();

    // ── H2: the note, and nothing else. The agreed model, and it must pass. ────────
    write(dir, NOTE_PATH, note([h1]));
    const h2 = commit(dir, "docs: commit the security-review note for H1");

    const atH2 = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(
      atH2.status,
      0,
      "the note-only head must PASS — this is the H1 -> note-only H2 model the finding " +
        `asks to preserve. Exited ${atH2.status}:\n${atH2.output}`,
    );
    assert.match(atH2.output, /is bound to reviewed head/);

    // ── H3: more code, same artefacts. Must fail. ─────────────────────────────────
    write(dir, "apps/api/src/auth.ts", "export const secret = 3;\n");
    const h3 = commit(dir, "feat: change the auth surface again");

    // Non-vacuity: the OLD predicate was "the linked note exists and Model is Opus".
    const old = evaluateInRepo(
      dir,
      `import { exists, repoRoot } from "./scripts/ci/lib/repo.mjs";
       import path from "node:path";
       console.log(JSON.stringify({
         noteStillExists: await exists(path.join(repoRoot, ${JSON.stringify(NOTE_PATH)})),
       }));`,
    );
    assert.equal(
      old.noteStillExists,
      true,
      "the probe is vacuous: the pre-fix check verified only that the linked note " +
        "exists, so if it no longer exists the failure below is not attributable to " +
        "staleness.",
    );

    const atH3 = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(
      atH3.status,
      1,
      "a code commit after the reviewed head must make the note stale. Exited " +
        `${atH3.status}:\n${atH3.output}`,
    );
    assert.match(atH3.output, /is STALE/);
    assert.match(atH3.output, /apps\/api\/src\/auth\.ts/);
    assert.ok(
      atH3.output.includes(h1.slice(0, 9)),
      `the failure must name the head the note is bound to (${h1.slice(0, 9)}):\n${atH3.output}`,
    );

    // ── H4: a fresh delta review, recorded. Must pass again. ──────────────────────
    write(dir, NOTE_PATH, note([h1, h3]));
    commit(dir, "docs: record the delta review of H3");

    const atH4 = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(
      atH4.status,
      0,
      "recording the new head in a note-only commit must clear the gate — otherwise the " +
        `delta-review model has no way to close. Exited ${atH4.status}:\n${atH4.output}`,
    );
    assert.ok(
      atH4.output.includes(h3.slice(0, 9)),
      `the pass must be attributed to the NEWEST attested head ${h3.slice(0, 9)}, not to ` +
        `${h1.slice(0, 9)}:\n${atH4.output}`,
    );
    assert.notEqual(h2, h3);
  });

  it("refuses a note that keeps only the old heads while code moves on", () => {
    // The explicit "a later H3 cannot keep the H1/H2 artefacts and pass" case: the note
    // is left exactly as the earlier review wrote it across two further code commits.
    const { dir, h1 } = reviewedScenario();
    write(dir, NOTE_PATH, note([h1]));
    commit(dir, "docs: the note for H1");

    write(
      dir,
      "apps/api/src/middleware/require-session.ts",
      "export const a = 1;\n",
    );
    commit(dir, "feat: H3");
    write(
      dir,
      "packages/permissions/src/evaluator.ts",
      "export const b = 2;\n",
    );
    commit(dir, "feat: H4, still no new review");

    const run = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, /is STALE/);
    assert.match(run.output, /apps\/api\/src\/middleware\/require-session\.ts/);
    assert.match(run.output, /packages\/permissions\/src\/evaluator\.ts/);
  });

  it("refuses a note with no reviewed head at all", () => {
    const { dir } = reviewedScenario();
    write(
      dir,
      NOTE_PATH,
      "# Pre-merge security review — PR #19\n\n**Verdict:** CLEAR.\n",
    );
    commit(dir, "docs: a note that names no head");

    const run = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, /declares no reviewed head/);
  });

  it("refuses a note whose heads are not in this branch — the post-rebase orphan", () => {
    const { dir } = reviewedScenario();
    write(dir, NOTE_PATH, note(["0".repeat(39) + "1"]));
    commit(dir, "docs: a note naming a head this branch does not contain");

    const run = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, /none of them is usable/);
    assert.match(run.output, /not an object in this repository/);
  });

  it("does not read SHAs written in prose — only the declared field", () => {
    // The notes on file cite merge bases and post-rebase orphans in prose. A parser that
    // scooped up every backticked SHA would bind the gate to whichever one it found
    // first, which is a coin flip dressed as a control.
    const source = [
      "# Pre-merge security review",
      "",
      "**Reviewed at:** `a4147a1` (original, merge base `38ff9ac`) → `e022ad5`.",
      "",
      `**Reviewed head:** \`${"a".repeat(40)}\``,
      "",
      `Merge base was \`${"b".repeat(40)}\`, and \`${"c".repeat(40)}\` is an orphan.`,
      "",
    ].join("\n");

    assert.deepEqual(attestedHeads(source), ["a".repeat(40)]);
  });

  it("rejects a self-attesting head — rule 4, against an injected reader", () => {
    // Not constructible in git with full SHAs (a commit whose tree names its own hash is
    // a fixed point), so the rule is probed by supplying the note contents the plumbing
    // could not: the note AT the attested commit already declaring that commit. The
    // commit itself is real — this repository's own HEAD — so ancestry resolves and the
    // assertion is about rule 4 and nothing else.
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const source = note([sha]);

    const binding = reviewBinding({
      notePath: NOTE_PATH,
      noteSource: source,
      head: sha,
      readNoteAt: () => source,
    });

    assert.equal(binding.kind, "unbound");
    assert.deepEqual(binding.selfAttested, [sha]);
    assert.match(binding.reason, /self-attested/);

    // The control: identical input, except the note was absent at the attested commit.
    // Without it, a check that rejected every input would satisfy the assertion above.
    const clean = reviewBinding({
      notePath: NOTE_PATH,
      noteSource: source,
      head: sha,
      readNoteAt: () => null,
    });
    assert.equal(clean.kind, "bound");
    assert.equal(clean.head, sha);
    assert.deepEqual(clean.selfAttested, []);
  });

  it("accepts the same head when the note did not exist at it", () => {
    // The control for the rule above: identical input except that the note is absent at
    // the attested commit, which is the ordinary case.
    const { dir, h1 } = reviewedScenario();
    write(dir, NOTE_PATH, note([h1]));
    commit(dir, "docs: the note for H1");

    const run = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(run.status, 0, `exited ${run.status}\n${run.output}`);
  });
});
