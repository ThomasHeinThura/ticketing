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
  git,
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
    write(dir, NOTE_PATH, note([`${"0".repeat(39)}1`]));
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

describe("GPT-F5 — the binding is over LANDED COMMITS, not the net tree", () => {
  it("stays RED after an exact revert, where the endpoint diff is empty", () => {
    // The bypass, built commit by commit:
    //
    //   H1  code                    reviewed
    //   H2  the note, nothing else  -> GREEN
    //   H3  modify non-review code  -> RED
    //   H4  exactly revert H3       -> net tree == H1 + note, so the OLD endpoint
    //                                 predicate saw an empty range and passed
    //   fresh review attests H4
    //   H5  note-only record        -> GREEN again
    const { dir, h1 } = reviewedScenario();

    write(dir, NOTE_PATH, note([h1]));
    commit(dir, "docs: the note for H1");

    const atH2 = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(atH2.status, 0, `H2 must be GREEN\n${atH2.output}`);

    // H3 — a real change to a security path the reviewer never saw.
    write(dir, "apps/api/src/auth.ts", "export const secret = 99;\n");
    const h3 = commit(dir, "feat: H3, an unreviewed change");

    const atH3 = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(atH3.status, 1, `H3 must be RED\n${atH3.output}`);
    assert.match(atH3.output, /is STALE/);

    // H4 — revert H3 exactly. `git revert` rather than rewriting the file by hand, so
    // the revert is a real landed commit and the trees genuinely coincide.
    git(dir, ["revert", "--no-edit", h3]);
    const h4 = git(dir, ["rev-parse", "HEAD"]).trim();

    // ── non-vacuity: the SUPERSEDED endpoint predicate sees an empty range ─────────
    const endpoint = evaluateInRepo(
      dir,
      `import { changedPathsBetween, commitsBetween } from "./scripts/ci/lib/git-baseline.mjs";
       const net = changedPathsBetween(${JSON.stringify(h1)}, "HEAD");
       const landed = commitsBetween(${JSON.stringify(h1)}, "HEAD");
       const prefix = "docs/07-planning/security-reviews/";
       console.log(JSON.stringify({
         netOutsideArtefacts: net.filter((f) => !f.startsWith(prefix)),
         landedCommits: landed.length,
         landedOutsideArtefacts: landed
           .filter((c) => c.paths.some((f) => !f.startsWith(prefix)))
           .map((c) => c.sha.slice(0, 9)),
       }));`,
    );

    assert.deepEqual(
      endpoint.netOutsideArtefacts,
      [],
      "the probe is vacuous: the net tree still differs outside the artefact prefix, so " +
        "the superseded endpoint predicate would ALSO have failed here and the assertion " +
        "below proves nothing about landed history.\n" +
        JSON.stringify(endpoint),
    );
    assert.equal(
      endpoint.landedOutsideArtefacts.length,
      2,
      "two commits landed after the reviewed head that touched non-review paths — H3 and " +
        `its revert. Saw: ${JSON.stringify(endpoint.landedOutsideArtefacts)}`,
    );

    const atH4 = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(
      atH4.status,
      1,
      "H4 must STAY RED. An exact revert makes the endpoint trees agree, and the " +
        "invariant is over landed commits — reverting does not restore a clearance. " +
        `Exited ${atH4.status}:\n${atH4.output}`,
    );
    assert.match(atH4.output, /is STALE/);
    assert.match(atH4.output, /commit\(s\) that LANDED after it/);
    assert.match(
      atH4.output,
      /reverting a commit does NOT restore the clearance/,
    );
    assert.ok(
      atH4.output.includes(h3.slice(0, 9)),
      `the failure must name H3 (${h3.slice(0, 9)}) as a landed commit:\n${atH4.output}`,
    );
    assert.ok(
      atH4.output.includes(h4.slice(0, 9)),
      `and the revert itself (${h4.slice(0, 9)}):\n${atH4.output}`,
    );

    // ── a fresh review attests H4; H5 records it, note-only ───────────────────────
    write(dir, NOTE_PATH, note([h1, h4]));
    commit(dir, "docs: record the delta review of H4");

    const atH5 = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(
      atH5.status,
      0,
      "H5 must be GREEN — a fresh review of H4, recorded in a note-only commit, is the " +
        `only thing that clears this. Exited ${atH5.status}:\n${atH5.output}`,
    );
    assert.ok(atH5.output.includes(h4.slice(0, 9)), atH5.output);
  });

  it("attributes a conflict-free merge conservatively, and does not miss what it carried", () => {
    // A merge is enumerated together with the commits it brought in, so nothing a merge
    // carried can hide behind it. Built with a side branch whose commit touches a
    // security path: the side commit must be reported, and the merge is charged the
    // union of its per-parent diffs.
    //
    // GPT-F6 changed what this probe expects. It used to assert the merge contributed
    // `[]`, from `diff-tree -c`. That combined diff is intersection-flavoured and can
    // OMIT a path the merge changed relative to the reviewed parent, which is a bypass
    // (see the hostile-merge probe below). The union over-attributes instead: this merge
    // is now charged with the side branch's path as well, even though it only carried
    // it. That is the deliberate trade — over-attribution costs a fresh delta review,
    // under-attribution ships unreviewed content.
    const { dir, h1 } = reviewedScenario();
    write(dir, NOTE_PATH, note([h1]));
    const h2 = commit(dir, "docs: the note for H1");

    git(dir, ["branch", "side", h1]);
    // Commit onto the side branch without moving the working tree: write a tree by hand.
    write(dir, "apps/api/src/webhooks/outbound.ts", "export const side = 1;\n");
    const sideSha = commit(dir, "feat: a change on the side of history");
    git(dir, ["update-ref", "refs/heads/side", sideSha]);
    // Put HEAD back where it was, then merge the side branch in.
    git(dir, ["reset", "--hard", "-q", h2]);
    git(dir, ["merge", "--no-ff", "--no-edit", "-q", "side"]);
    const mergeSha = git(dir, ["rev-parse", "HEAD"]).trim();

    const seen = evaluateInRepo(
      dir,
      `import { commitsBetween } from "./scripts/ci/lib/git-baseline.mjs";
       console.log(JSON.stringify(
         commitsBetween(${JSON.stringify(h1)}, "HEAD").map((c) => ({
           sha: c.sha.slice(0, 9),
           parents: c.parents.length,
           paths: c.paths,
         })),
       ));`,
    );

    const bySha = new Map(seen.map((c) => [c.sha, c]));
    assert.ok(
      bySha.has(sideSha.slice(0, 9)),
      `the side branch's own commit must be enumerated, or a merge hides what it ` +
        `carried. Saw: ${JSON.stringify(seen)}`,
    );
    assert.deepEqual(bySha.get(sideSha.slice(0, 9)).paths, [
      "apps/api/src/webhooks/outbound.ts",
    ]);
    const merge = bySha.get(mergeSha.slice(0, 9));
    assert.equal(merge.parents, 2, JSON.stringify(seen));
    assert.deepEqual(
      merge.paths,
      ["apps/api/src/webhooks/outbound.ts"],
      "the merge must be charged the UNION of its per-parent diffs. Relative to its " +
        "first parent this merge does change that file, so an attribution that reported " +
        "nothing here would be the GPT-F6 shape — and duplicating the side branch's own " +
        "entry is harmless, because the only consequence is a fresh delta review.",
    );

    const run = runChecker(dir, "check-pr-template.mjs", [
      "--body",
      bodyWithNote(),
    ]);
    assert.equal(run.status, 1, `exited ${run.status}\n${run.output}`);
    assert.match(run.output, /apps\/api\/src\/webhooks\/outbound\.ts/);
  });
});

describe("GPT-F6 — merge attribution may not use combined-diff semantics", () => {
  it("catches a merge whose tree is taken wholesale from an ancestor", () => {
    // The hostile shape, built with plumbing because no porcelain command produces it:
    //
    //   A    f.txt = "old"
    //   H1   f.txt = "reviewed"        <- the reviewed head, child of A
    //   M    git commit-tree A^{tree} -p H1 -p A
    //
    // M's tree IS A's tree, so for f.txt the merge result equals its SECOND parent. A
    // combined diff reports only paths that differ from EVERY parent, so it reports
    // nothing — while the tree that would merge has f.txt back at "old" and the review
    // of H1 covers content no longer present. `rev-list H1..M` is just M, because A is
    // an ancestor of H1, so there is no side-branch commit to catch it either.
    const dir = scratchDir("hostile-merge");
    initRepo(dir);
    installCheckers(dir);

    write(dir, "f.txt", "old\n");
    const a = commit(dir, "A: f.txt = old");
    setOriginMain(dir, a);

    write(dir, "f.txt", "reviewed\n");
    const h1 = commit(dir, "H1: f.txt = reviewed");

    const tree = git(dir, ["rev-parse", `${a}^{tree}`]).trim();
    const m = git(dir, [
      "commit-tree",
      tree,
      "-p",
      h1,
      "-p",
      a,
      "-m",
      "M: merge whose tree is A's, so the combined diff is empty",
    ]).trim();
    git(dir, ["update-ref", "HEAD", m]);

    // 1. The range is M and nothing else — no side-branch commit can catch this.
    assert.deepEqual(
      git(dir, ["rev-list", `${h1}..${m}`])
        .trim()
        .split("\n"),
      [m],
      "the construction is wrong if anything but M is in the range; the whole point is " +
        "that there is no other commit to attribute the change to.",
    );
    assert.deepEqual(
      git(dir, ["rev-list", "--parents", "-n", "1", m])
        .trim()
        .split(/\s+/)
        .slice(1),
      [h1, a],
      "M's first parent must be H1 and its second A",
    );

    // 5. The content genuinely differs from the reviewed tree.
    assert.deepEqual(
      git(dir, ["diff", "--name-only", h1, m]).trim().split("\n"),
      ["f.txt"],
      "if f.txt does not differ from the reviewed head, nothing unreviewed is shipping " +
        "and this probe proves nothing.",
    );
    assert.equal(git(dir, ["show", `${m}:f.txt`]).trim(), "old");

    // 2 + 3. The OLD predicate against the SHIPPED one, in the same repository.
    // NB: these snippets are template literals, so `\n` inside one becomes a real
    // newline before node parses it. Use String.fromCharCode(10) — no backslashes.
    const measured = evaluateInRepo(
      dir,
      `import { spawnSync } from "node:child_process";
       import { commitsBetween } from "./scripts/ci/lib/git-baseline.mjs";
       import { repoRoot } from "./scripts/ci/lib/repo.mjs";
       const g = (args) =>
         spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" })
           .stdout.split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
       console.log(JSON.stringify({
         combined: g(["diff-tree", "--no-commit-id", "--name-only", "-r", "-c", ${JSON.stringify(m)}]),
         shipped: commitsBetween(${JSON.stringify(h1)}, ${JSON.stringify(m)}).map((c) => ({
           sha: c.sha, parents: c.parents.length, paths: c.paths,
         })),
       }));`,
    );

    assert.deepEqual(
      measured.combined,
      [],
      "the probe is vacuous: `diff-tree -c` now reports this path, so the combined-diff " +
        "predicate would ALSO have caught this shape and the assertion below proves " +
        `nothing about the fix. Saw: ${JSON.stringify(measured.combined)}`,
    );
    assert.deepEqual(
      measured.shipped,
      [{ sha: m, parents: 2, paths: ["f.txt"] }],
      "the shipped attribution must charge the merge with f.txt, from the UNION of its " +
        "per-parent diffs.",
    );

    // 3 + 4. The binding itself: RED, naming M and f.txt.
    const binding = evaluateInRepo(
      dir,
      `import { reviewBinding } from "./scripts/ci/lib/security-review-note.mjs";
       const nl = String.fromCharCode(10);
       const tick = String.fromCharCode(96);
       const note = ["# note", "", "**Reviewed head:** " + tick +
         ${JSON.stringify(h1)} + tick, ""].join(nl);
       console.log(JSON.stringify(reviewBinding({
         notePath: ${JSON.stringify(NOTE_PATH)},
         noteSource: note,
         head: ${JSON.stringify(m)},
       })));`,
    );

    assert.equal(
      binding.kind,
      "unbound",
      `the review of H1 must NOT survive M. Got: ${JSON.stringify(binding)}`,
    );
    assert.deepEqual(binding.offending, [m], JSON.stringify(binding));
    assert.deepEqual(binding.drifted, ["f.txt"], JSON.stringify(binding));
    assert.ok(
      binding.reason.includes(m.slice(0, 9)),
      `the failure must name M (${m.slice(0, 9)}):\n${binding.reason}`,
    );
    assert.match(binding.reason, /f\.txt/);
    assert.match(binding.reason, /\(merge\)/);
    assert.match(binding.reason, /is STALE/);
  });

  it("still passes a merge that changes nothing at all", () => {
    // The other direction: a merge whose tree equals BOTH parents contributes nothing,
    // and the union of two empty diffs is empty. Without this, the conservative union
    // could be satisfied by a check that simply charged every merge with everything.
    const dir = scratchDir("empty-merge");
    initRepo(dir);
    installCheckers(dir);
    write(dir, "f.txt", "same\n");
    const a = commit(dir, "A");
    setOriginMain(dir, a);
    const b = commit(dir, "B: empty commit, same tree");

    const tree = git(dir, ["rev-parse", `${b}^{tree}`]).trim();
    const m = git(dir, [
      "commit-tree",
      tree,
      "-p",
      b,
      "-p",
      a,
      "-m",
      "M: identical to both parents",
    ]).trim();
    git(dir, ["update-ref", "HEAD", m]);

    const measured = evaluateInRepo(
      dir,
      `import { commitsBetween } from "./scripts/ci/lib/git-baseline.mjs";
       console.log(JSON.stringify(
         commitsBetween(${JSON.stringify(b)}, ${JSON.stringify(m)}).map((c) => c.paths),
       ));`,
    );
    assert.deepEqual(measured, [[]]);
  });
});
