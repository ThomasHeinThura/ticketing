/** Current phase-review evidence contract. Historical Spec/n-a review-section parsing
 * is retired; no archived process register governs ordinary implementation changes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  bodyFile,
  cleanUpScratchRepos,
  commit,
  completeBody,
  git,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";

after(cleanUpScratchRepos);
function scenario() {
  const dir = scratchDir("phase-review");
  initRepo(dir);
  installCheckers(dir);
  // The dependency symlink is test infrastructure, as node_modules is in a real checkout.
  // Use local excludes so cases replacing .gitignore cannot accidentally commit it.
  write(dir, ".git/info/exclude", "node_modules\n");
  installFromRepo(dir, ".github/pull_request_template.md");
  assert.equal(existsSync(path.join(dir, "archive")), false);
  write(dir, "source.ts", "export const phaseFixture = true;\n");
  commit(dir, "synthetic reviewed source");
  const report = "docs/evidence/P1-review.json";
  const evidence = {};
  for (const kind of ["requirements", "diff", "tests", "browser", "security"]) {
    const file = `docs/evidence/${kind}.txt`;
    write(
      dir,
      file,
      `Synthetic ${kind} parser fixture, not acceptance evidence.\n`,
    );
    evidence[kind] = [file];
  }
  const digest = runChecker(dir, "check-reviews.mjs", [
    "--print-source-digest",
    "--report",
    report,
  ]);
  assert.equal(digest.status, 0, digest.output);
  const body = {
    phase: "P1",
    sourceSha: git(dir, ["rev-parse", "HEAD"]).trim(),
    sourceDigest: digest.stdout.trim(),
    reviewer: "independent-reviewer",
    implementers: ["implementation-agent"],
    coverage: ["design", "integration", "security"],
    evidence,
    evidenceSha256: Object.fromEntries(
      Object.values(evidence)
        .flat()
        .map((file) => [
          file,
          createHash("sha256")
            .update(readFileSync(path.join(dir, file)))
            .digest("hex"),
        ]),
    ),
    findings: [],
  };
  return { dir, report, body };
}
function check(fixture, mutate = () => {}) {
  mutate(fixture.body);
  write(fixture.dir, fixture.report, JSON.stringify(fixture.body));
  return runChecker(fixture.dir, "check-reviews.mjs", [
    "--phase",
    "P1",
    "--report",
    fixture.report,
  ]);
}
describe("one independent consolidated review per submitted phase", () => {
  it("ordinary integration explicitly reports that no phase or review was submitted", () => {
    const f = scenario();
    const result = runChecker(f.dir, "check-reviews.mjs");
    assert.equal(result.status, 0, result.output);
    assert.match(
      result.output,
      /phase not submitted; no independent review or phase acceptance inferred/,
    );
  });
  it("validates a real report structure and current source binding without claiming Thomas acceptance", () => {
    const result = check(scenario());
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Thomas acceptance is recorded separately/);
  });
  for (const args of [["--phase"], ["--phase", "P1"], ["--report"]])
    it(`fails closed for incomplete explicit submission ${args.join(" ")}`, () => {
      const f = scenario();
      const result = runChecker(f.dir, "check-reviews.mjs", args);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /requires --phase/);
    });
  for (const [name, mutate, expected] of [
    [
      "self review",
      (body) => {
        body.reviewer = " IMPLEMENTATION-AGENT ";
      },
      /cannot independently review/,
    ],
    [
      "missing security coverage",
      (body) => {
        body.coverage = ["design", "integration"];
      },
      /cover design, integration and security/,
    ],
    [
      "missing browser evidence",
      (body) => {
        body.evidence.browser = [];
      },
      /browser evidence/,
    ],
    [
      "unreadable evidence",
      (body) => {
        body.evidence.tests = ["missing.txt"];
      },
      /ENOENT/,
    ],
    [
      "archive evidence",
      (body) => {
        body.evidence.tests = ["archive/ignored.txt"];
      },
      /outside the ignored archive/,
    ],
    [
      "open findings",
      (body) => {
        body.findings = [
          {
            id: "S1",
            status: "open",
            evidence: ["docs/evidence/security.txt"],
          },
        ];
      },
      /open\/deferred findings do not pass/,
    ],
    [
      "deferred findings",
      (body) => {
        body.findings = [
          {
            id: "S1",
            status: "deferred",
            evidence: ["docs/evidence/security.txt"],
          },
        ];
      },
      /open\/deferred findings do not pass/,
    ],
    [
      "stale revision",
      (body) => {
        body.sourceSha = "0".repeat(40);
      },
      /verified ancestor/,
    ],
    [
      "different phase",
      (body) => {
        body.phase = "P2";
      },
      /phase does not match/,
    ],
  ])
    it(`rejects ${name}`, () => {
      const result = check(scenario(), mutate);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, expected);
    });
  it("requires repair evidence for every resolved finding", () => {
    const result = check(scenario(), (body) => {
      body.findings = [
        { id: "S1", status: "resolved", evidence: ["docs/evidence/tests.txt"] },
      ];
    });
    assert.equal(result.status, 0, result.output);
  });
  it("detects source edits after review, including untracked application files", () => {
    const f = scenario();
    write(f.dir, "new-source.ts", "export const changedAfterReview = true;\n");
    const result = check(f);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /sourceDigest does not match/);
  });
});

describe("source and evidence binding survives only exact reviewed source", () => {
  it("allows committing the exact report and already-reviewed evidence without another review round", () => {
    const f = scenario();
    write(f.dir, f.report, JSON.stringify(f.body));
    commit(f.dir, "record the one consolidated review");
    const result = check(f);
    assert.equal(result.status, 0, result.output);
  });
  it("binds maintained requirements and every other evidence path after review", () => {
    const f = scenario();
    write(
      f.dir,
      "docs/evidence/requirements.txt",
      "Changed intended behavior after review.\n",
    );
    const result = check(f);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /sourceDigest does not match/);
  });
  it("rejects a claimed source from an unrelated branch", () => {
    const f = scenario();
    const tree = git(f.dir, ["rev-parse", "HEAD^{tree}"]).trim();
    f.body.sourceSha = git(f.dir, [
      "commit-tree",
      tree,
      "-m",
      "unrelated synthetic source",
    ]).trim();
    const result = check(f);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /verified ancestor/);
  });
  it("hashes referenced ignored evidence instead of relying on source enumeration", () => {
    const f = scenario();
    write(f.dir, ".gitignore", "*.proof\n");
    const proof = "docs/evidence/browser.proof";
    write(f.dir, proof, "Original rendered evidence.\n");
    f.body.evidence.browser = [proof];
    delete f.body.evidenceSha256["docs/evidence/browser.txt"];
    f.body.evidenceSha256[proof] = createHash("sha256")
      .update("Original rendered evidence.\n")
      .digest("hex");
    const digest = runChecker(f.dir, "check-reviews.mjs", [
      "--print-source-digest",
      "--report",
      f.report,
    ]);
    assert.equal(digest.status, 0, digest.output);
    f.body.sourceDigest = digest.stdout.trim();
    write(f.dir, proof, "Replaced after review.\n");
    const result = check(f);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /Evidence SHA-256 does not match/);
  });
  it("does not permit an arbitrary maintained contract as the excluded report artifact", () => {
    const f = scenario();
    const result = runChecker(f.dir, "check-reviews.mjs", [
      "--print-source-digest",
      "--report",
      "docs/technical/ci-gates.md",
    ]);
    assert.notEqual(result.status, 0, result.output);
  });
});

describe("actual PR phase completion caller", () => {
  it("ordinary integration needs no per-change reviewer section", () => {
    const f = scenario();
    const result = runChecker(f.dir, "check-pr-template.mjs", [
      "--body",
      bodyFile(completeBody()),
    ]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /phase not submitted/);
  });
  it("an explicit completed phase with a missing report fails instead of an ordinary pass", () => {
    const f = scenario();
    const body = completeBody().replace(
      "**Phase:** not submitted",
      `**Phase:** P1\n**Report:** ${f.report}`,
    );
    const result = runChecker(f.dir, "check-pr-template.mjs", [
      "--body",
      bodyFile(body),
    ]);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /ENOENT/);
  });
  it("the actual PR caller validates the single source-bound report", () => {
    const f = scenario();
    write(f.dir, f.report, JSON.stringify(f.body));
    const body = completeBody().replace(
      "**Phase:** not submitted",
      `**Phase:** P1\n**Report:** ${f.report}`,
    );
    const result = runChecker(f.dir, "check-pr-template.mjs", [
      "--body",
      bodyFile(body),
    ]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Thomas acceptance remains separate/);
  });
  it("a PR cannot declare a phase complete after changing reviewed source", () => {
    const f = scenario();
    write(f.dir, f.report, JSON.stringify(f.body));
    write(f.dir, "source.ts", "changed after review\n");
    const body = completeBody().replace(
      "**Phase:** not submitted",
      `**Phase:** P1\n**Report:** ${f.report}`,
    );
    const result = runChecker(f.dir, "check-pr-template.mjs", [
      "--body",
      bodyFile(body),
    ]);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /sourceDigest does not match/);
  });
});

describe("verified GitHub PR source binding", () => {
  function mergedFixture() {
    const f = scenario();
    write(f.dir, f.report, JSON.stringify(f.body));
    const head = commit(f.dir, "record review only");
    const tree = git(f.dir, ["rev-parse", `${head}^{tree}`]).trim();
    const merge = git(f.dir, [
      "commit-tree",
      tree,
      "-p",
      f.body.sourceSha,
      "-p",
      head,
      "-m",
      "synthetic pull request merge",
    ]).trim();
    git(f.dir, ["update-ref", "refs/heads/main", merge]);
    return { ...f, head };
  }
  it("accepts the verified second-parent PR head with exact reviewed source", () => {
    const f = mergedFixture();
    const payload = bodyFile(
      JSON.stringify({ pull_request: { head: { sha: f.head } } }),
    );
    const result = runChecker(
      f.dir,
      "check-reviews.mjs",
      ["--phase", "P1", "--report", f.report],
      { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: payload },
    );
    assert.equal(result.status, 0, result.output);
  });
  it("does not trust a payload naming the base parent as the PR head", () => {
    const f = mergedFixture();
    const payload = bodyFile(
      JSON.stringify({ pull_request: { head: { sha: f.body.sourceSha } } }),
    );
    const result = runChecker(
      f.dir,
      "check-reviews.mjs",
      ["--phase", "P1", "--report", f.report],
      { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: payload },
    );
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /source head is not verified/);
  });
  it("fails closed on missing PR source payload", () => {
    const f = scenario();
    write(f.dir, f.report, JSON.stringify(f.body));
    const result = runChecker(
      f.dir,
      "check-reviews.mjs",
      ["--phase", "P1", "--report", f.report],
      { GITHUB_EVENT_NAME: "pull_request" },
    );
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /payload is unavailable/);
  });
});

it("rejects contradictory repeated phase CLI flags", () => {
  const f = scenario();
  const result = runChecker(f.dir, "check-reviews.mjs", [
    "--phase",
    "P1",
    "--phase",
    "P2",
    "--report",
    f.report,
  ]);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /phase flags must not repeat/);
});

describe("reviewed source symlink targets", () => {
  it("rejects a source link outside the checkout instead of binding only its name", () => {
    const f = scenario();
    const external = scratchDir("phase-external-source");
    write(external, "external.ts", "export const outside = true;\n");
    symlinkSync(
      path.join(external, "external.ts"),
      path.join(f.dir, "linked.ts"),
    );
    const result = runChecker(f.dir, "check-reviews.mjs", [
      "--print-source-digest",
      "--report",
      f.report,
    ]);
    assert.notEqual(result.status, 0, result.output);
    assert.match(
      result.output,
      /Source symlink must resolve to a repository file/,
    );
  });
  it("binds an internal ignored file's bytes reached through a source link", () => {
    const f = scenario();
    write(f.dir, ".gitignore", "private-source.ts\n");
    write(f.dir, "private-source.ts", "export const value = 1;\n");
    symlinkSync("private-source.ts", path.join(f.dir, "linked.ts"));
    const digest = runChecker(f.dir, "check-reviews.mjs", [
      "--print-source-digest",
      "--report",
      f.report,
    ]);
    assert.equal(digest.status, 0, digest.output);
    f.body.sourceDigest = digest.stdout.trim();
    assert.equal(check(f).status, 0);
    write(f.dir, "private-source.ts", "export const value = 2;\n");
    const result = check(f);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /sourceDigest does not match/);
  });
  it("rejects source links into the ignored archive", () => {
    const f = scenario();
    write(f.dir, ".gitignore", "archive/\n");
    write(f.dir, "archive/old.ts", "export const historical = true;\n");
    symlinkSync("archive/old.ts", path.join(f.dir, "linked.ts"));
    const result = runChecker(f.dir, "check-reviews.mjs", [
      "--print-source-digest",
      "--report",
      f.report,
    ]);
    assert.notEqual(result.status, 0, result.output);
    assert.match(
      result.output,
      /Source symlink must resolve to a repository file/,
    );
  });
});
