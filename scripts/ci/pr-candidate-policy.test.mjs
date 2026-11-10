import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CANDIDATE_IDENTITY,
  CANDIDATE_ISSUER,
  CANDIDATE_PREDICATE,
  CANDIDATE_REPOSITORY,
  CANDIDATE_WORKFLOW,
  candidateCoordinates,
  validateCandidateStatement,
  verifyPrCandidate,
} from "../../deploy/pr-candidate-attestation.mjs";
import {
  candidatePredicate,
  expectedFromEnv,
  resolveCandidate,
  validateCandidateStage,
} from "./pr-candidate-policy.mjs";

const source = "a".repeat(40);
const main = "b".repeat(40);
const digest = `sha256:${"1".repeat(64)}`;
function environment() {
  const coordinates = candidateCoordinates({
    runId: "123",
    runAttempt: "2",
    sourceSha: source,
  });
  return {
    GITHUB_REPOSITORY: CANDIDATE_REPOSITORY,
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: main,
    GITHUB_WORKFLOW_SHA: main,
    GITHUB_WORKFLOW_REF: `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@refs/heads/main`,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    RESOLVED_RUN_ID: "123",
    RESOLVED_RUN_ATTEMPT: "2",
    BUILD_RUN_ID: "123",
    BUILD_RUN_ATTEMPT: "2",
    SCAN_RUN_ID: "123",
    SCAN_RUN_ATTEMPT: "2",
    PUBLISH_RUN_ID: "123",
    PUBLISH_RUN_ATTEMPT: "2",
    INPUT_SOURCE_BRANCH: "fix/example",
    INPUT_SOURCE_SHA: source,
    INPUT_TARGET_MAIN_SHA: main,
    INPUT_PULL_REQUEST: "7",
    SOURCE_REF: "refs/heads/fix/example",
    SOURCE_SHA: source,
    TARGET_MAIN_SHA: main,
    POLICY_SHA: main,
    PULL_REQUEST: "7",
    CANDIDATE_IMAGE: coordinates.name,
    CANDIDATE_DIGEST: digest,
    AMD64_DIGEST: `sha256:${"2".repeat(64)}`,
    ARM64_DIGEST: `sha256:${"3".repeat(64)}`,
    BUILD_ARTIFACT_ID: "234",
    BUILD_ARTIFACT_DIGEST: "4".repeat(64),
    AMD64_SBOM_DIGEST: `sha256:${"5".repeat(64)}`,
    ARM64_SBOM_DIGEST: `sha256:${"6".repeat(64)}`,
  };
}
function statement(env = environment()) {
  return {
    _type: "https://in-toto.io/Statement/v0.1",
    predicateType: CANDIDATE_PREDICATE,
    subject: [
      {
        name: env.CANDIDATE_IMAGE,
        digest: { sha256: env.CANDIDATE_DIGEST.slice(7) },
      },
    ],
    predicate: candidatePredicate(env),
  };
}
function ghRunner(mutate = () => {}) {
  const calls = [];
  const run = (bin, args) => {
    calls.push([bin, ...args]);
    assert.equal(bin, "gh");
    const endpoint = args[1];
    let result;
    if (endpoint.endsWith("git/ref/heads/main"))
      result = {
        ref: "refs/heads/main",
        object: { type: "commit", sha: main },
      };
    else if (endpoint.endsWith("git/ref/heads/fix/example"))
      result = {
        ref: "refs/heads/fix/example",
        object: { type: "commit", sha: source },
      };
    else if (endpoint.endsWith("pulls/7"))
      result = {
        number: 7,
        state: "open",
        head: {
          ref: "fix/example",
          sha: source,
          repo: { full_name: CANDIDATE_REPOSITORY },
        },
        base: {
          ref: "main",
          sha: main,
          repo: { full_name: CANDIDATE_REPOSITORY },
        },
      };
    else if (endpoint.endsWith(`git/commits/${source}`))
      result = { sha: source, committer: { date: "2026-11-10T01:02:03Z" } };
    else assert.fail(`unexpected endpoint ${endpoint}`);
    mutate(result, endpoint);
    return { status: 0, stdout: JSON.stringify(result) };
  };
  return { run, calls };
}
function cosignRunner(
  env = environment(),
  transform = () => {},
  failCommand = "",
) {
  const calls = [];
  const run = (bin, args, options) => {
    calls.push({ bin, args, options });
    assert.equal(bin, "cosign");
    if (args[0] === failCommand)
      return { status: 1, stderr: "private failure detail" };
    const p = statement(env).predicate;
    let output =
      args[0] === "verify"
        ? [
            {
              critical: {
                identity: { "docker-reference": p.image.name },
                image: { "docker-manifest-digest": p.image.digest },
              },
              optional: {
                purpose: p.purpose,
                source_sha: p.sourceCommit,
                tag: p.image.tag,
                workflow_run: p.run.url,
              },
            },
          ]
        : {
            payloadType: "application/vnd.in-toto+json",
            payload: Buffer.from(JSON.stringify(statement(env))).toString(
              "base64",
            ),
            signatures: [],
          };
    output = transform(output, args[0]) ?? output;
    return {
      status: 0,
      stdout: typeof output === "string" ? output : JSON.stringify(output),
    };
  };
  return { run, calls };
}
describe("trusted-main candidate issuance resolution", () => {
  it("resolves each ref once and records exact source, main, policy and PR", () => {
    const gh = ghRunner();
    const out = resolveCandidate(environment(), gh.run);
    assert.equal(out.source_sha, source);
    assert.equal(out.target_main_sha, main);
    assert.equal(out.policy_sha, main);
    assert.equal(out.pull_request, 7);
    assert.equal(
      gh.calls.filter((call) => call[2].includes("git/ref/")).length,
      2,
    );
  });
  it("allows an explicitly PR-less candidate and never reads a PR", () => {
    const gh = ghRunner();
    assert.equal(
      resolveCandidate({ ...environment(), INPUT_PULL_REQUEST: "" }, gh.run)
        .pull_request,
      "",
    );
    assert.equal(
      gh.calls.some((call) => call[2].includes("pulls/")),
      false,
    );
  });
  for (const [label, changes] of Object.entries({
    "non-main dispatch": { GITHUB_REF: "refs/heads/fix/evil" },
    "fork workflow": { GITHUB_REPOSITORY: "attacker/ticketing" },
    "untrusted workflow": { GITHUB_WORKFLOW_REF: "other" },
    "non-manual trigger": { GITHUB_EVENT_NAME: "pull_request_target" },
    "wrong main policy": { INPUT_TARGET_MAIN_SHA: source },
    "wrong workflow commit": { GITHUB_WORKFLOW_SHA: source },
    "short source": { INPUT_SOURCE_SHA: "abc" },
    "revision expression": { INPUT_SOURCE_BRANCH: "fix/x^{commit}" },
    "option ref": { INPUT_SOURCE_BRANCH: "--help" },
    "main source": { INPUT_SOURCE_BRANCH: "main" },
    "release source": { INPUT_SOURCE_BRANCH: "release/v1" },
    "traversal ref": { INPUT_SOURCE_BRANCH: "fix/../main" },
    "lock suffix ref": { INPUT_SOURCE_BRANCH: "fix/x.lock" },
    "hidden ref segment": { INPUT_SOURCE_BRANCH: "fix/.hidden" },
    "numeric run ID": { GITHUB_RUN_ID: 123 },
    "same main commit": { INPUT_SOURCE_SHA: main },
    "unsafe PR": { INPUT_PULL_REQUEST: "7;echo unsafe" },
    "noncanonical PR": { INPUT_PULL_REQUEST: "007" },
  }))
    it(`rejects ${label} before any GitHub read`, () => {
      const gh = ghRunner();
      assert.throws(() =>
        resolveCandidate({ ...environment(), ...changes }, gh.run),
      );
      assert.equal(gh.calls.length, 0);
    });
  for (const label of [
    "moved main",
    "moved head",
    "fork PR",
    "wrong PR base",
    "wrong PR head",
    "closed PR",
    "wrong PR number",
    "wrong source commit",
  ])
    it(`rejects ${label}`, () => {
      const gh = ghRunner((value, endpoint) => {
        if (label === "moved main" && endpoint.endsWith("heads/main"))
          value.object.sha = source;
        if (label === "moved head" && endpoint.endsWith("heads/fix/example"))
          value.object.sha = main;
        if (endpoint.endsWith("pulls/7")) {
          if (label === "fork PR")
            value.head.repo.full_name = "attacker/ticketing";
          if (label === "wrong PR base") value.base.sha = source;
          if (label === "wrong PR head") value.head.sha = main;
          if (label === "closed PR") value.state = "closed";
          if (label === "wrong PR number") value.number = 8;
        }
        if (
          label === "wrong source commit" &&
          endpoint.includes("git/commits/")
        )
          value.sha = main;
      });
      assert.throws(() => resolveCandidate(environment(), gh.run));
    });
  it("fails closed on API errors or malformed data without exposing private details", () => {
    assert.throws(
      () =>
        resolveCandidate(environment(), () => ({
          status: 1,
          stderr: "secret",
        })),
      /GitHub ref resolution failed/,
    );
    assert.throws(
      () =>
        resolveCandidate(environment(), () => ({ status: 0, stdout: "bad" })),
      /invalid JSON/,
    );
  });
});
describe("attempt and live-ref revalidation guards", () => {
  it("binds source resolution to the canonical run attempt", () => {
    const out = resolveCandidate(environment(), ghRunner().run);
    assert.equal(out.run_id, "123");
    assert.equal(out.run_attempt, "2");
  });
  it("allows a full current-attempt chain after exact live ref and PR revalidation", () => {
    const gh = ghRunner();
    assert.deepEqual(
      validateCandidateStage(
        environment(),
        ["BUILD", "SCAN", "PUBLISH"],
        gh.run,
      ),
      { run_id: "123", run_attempt: "2" },
    );
    assert.equal(
      gh.calls.filter((call) => call[2].includes("git/ref/")).length,
      2,
    );
    assert.equal(
      gh.calls.filter((call) => call[2].includes("pulls/7")).length,
      1,
    );
  });
  for (const producer of ["RESOLVED", "BUILD", "SCAN", "PUBLISH"])
    for (const field of ["RUN_ID", "RUN_ATTEMPT"])
      it(`rejects stale ${producer} ${field} before API access`, () => {
        const env = environment();
        const gh = ghRunner();
        env[`${producer}_${field}`] = "1";
        assert.throws(
          () =>
            validateCandidateStage(env, ["BUILD", "SCAN", "PUBLISH"], gh.run),
          /run attempt does not match/,
        );
        assert.equal(gh.calls.length, 0);
      });
  for (const changed of ["main", "source", "PR head", "PR state"])
    it(`rejects live ${changed} drift without rebinding the frozen selection`, () => {
      const env = environment();
      const gh = ghRunner((value, endpoint) => {
        if (changed === "main" && endpoint.endsWith("heads/main"))
          value.object.sha = "c".repeat(40);
        if (changed === "source" && endpoint.endsWith("heads/fix/example"))
          value.object.sha = "c".repeat(40);
        if (endpoint.endsWith("pulls/7") && changed === "PR head")
          value.head.sha = "c".repeat(40);
        if (endpoint.endsWith("pulls/7") && changed === "PR state")
          value.state = "closed";
      });
      assert.throws(() =>
        validateCandidateStage(env, ["BUILD", "SCAN", "PUBLISH"], gh.run),
      );
      assert.equal(env.SOURCE_SHA, source);
      assert.equal(env.TARGET_MAIN_SHA, main);
    });
});
describe("strict candidate statement and cryptographic verifier", () => {
  it("accepts a complete immutable candidate binding", () => {
    const env = environment();
    assert.deepEqual(
      validateCandidateStatement(statement(env), expectedFromEnv(env)),
      statement(env).predicate,
    );
  });
  const substitutions = {
    "release predicate": (s) => {
      s.predicateType = CANDIDATE_PREDICATE.replace(
        "pr-candidate",
        "release-source",
      );
    },
    "extra subject": (s) => {
      s.subject.push(s.subject[0]);
    },
    "wrong subject package": (s) => {
      s.subject[0].name = "ghcr.io/thomasheinthura/taskdesk";
    },
    "wrong subject digest": (s) => {
      s.subject[0].digest.sha256 = "f".repeat(64);
    },
    "wrong purpose": (s) => {
      s.predicate.purpose = "release";
    },
    "production eligibility": (s) => {
      s.predicate.productionEligible = true;
    },
    "wrong source repository": (s) => {
      s.predicate.sourceRepository = "attacker/ticketing";
    },
    "wrong source ref": (s) => {
      s.predicate.sourceRef = "refs/heads/fix/other";
    },
    "wrong source SHA": (s) => {
      s.predicate.sourceCommit = main;
    },
    "wrong target main": (s) => {
      s.predicate.targetMainCommit = source;
    },
    "wrong policy SHA": (s) => {
      s.predicate.policy.commit = source;
    },
    "wrong policy workflow": (s) => {
      s.predicate.policy.workflow = ".github/workflows/release.yml";
    },
    "wrong policy ref": (s) => {
      s.predicate.policy.ref = "refs/heads/fix/evil";
    },
    "wrong image package": (s) => {
      s.predicate.image.name = "ghcr.io/thomasheinthura/taskdesk";
    },
    "wrong image digest": (s) => {
      s.predicate.image.digest = `sha256:${"f".repeat(64)}`;
    },
    "wrong image tag": (s) => {
      s.predicate.image.tag = "edge";
    },
    "missing platform": (s) => {
      delete s.predicate.image.platforms["linux/arm64"];
    },
    "duplicate platform digest": (s) => {
      s.predicate.image.platforms["linux/arm64"] =
        s.predicate.image.platforms["linux/amd64"];
    },
    "invalid platform digest": (s) => {
      s.predicate.image.platforms["linux/amd64"] = "sha256:short";
    },
    "wrong run": (s) => {
      s.predicate.run.id = "124";
    },
    "wrong attempt": (s) => {
      s.predicate.run.attempt = "1";
    },
    "wrong run URL": (s) => {
      s.predicate.run.url = "https://example.com";
    },
    "wrong trigger": (s) => {
      s.predicate.run.event = "push";
    },
    "wrong PR": (s) => {
      s.predicate.pullRequest = 8;
    },
    "missing artifact": (s) => {
      s.predicate.buildArtifact.id = "";
    },
    "failed scan": (s) => {
      s.predicate.scan.result = "failed";
    },
    "weakened severity": (s) => {
      s.predicate.scan.severity = ["CRITICAL"];
    },
    "missing SBOM": (s) => {
      delete s.predicate.sboms["linux/arm64"];
    },
    "unknown schema key": (s) => {
      s.predicate.allowRelease = true;
    },
  };
  for (const [label, mutate] of Object.entries(substitutions))
    it(`rejects ${label}`, () => {
      const s = statement();
      mutate(s);
      assert.throws(() =>
        validateCandidateStatement(s, expectedFromEnv(environment())),
      );
    });
  it("pins exact issuer, workflow identity, policy commit, ref, repository and trigger in both cosign commands", () => {
    const env = environment();
    const cosign = cosignRunner();
    assert.equal(
      verifyPrCandidate({ ...expectedFromEnv(env), run: cosign.run })
        .sourceCommit,
      source,
    );
    assert.equal(cosign.calls.length, 2);
    for (const { args, options } of cosign.calls) {
      for (const [flag, value] of [
        ["--certificate-oidc-issuer", CANDIDATE_ISSUER],
        ["--certificate-identity", CANDIDATE_IDENTITY],
        ["--certificate-github-workflow-sha", main],
        ["--certificate-github-workflow-ref", "refs/heads/main"],
        ["--certificate-github-workflow-repository", CANDIDATE_REPOSITORY],
        ["--certificate-github-workflow-trigger", "workflow_dispatch"],
      ])
        assert.equal(args[args.indexOf(flag) + 1], value);
      assert.equal(args.at(-1), `${env.CANDIDATE_IMAGE}@${digest}`);
      assert.equal(options.stdio[0], "ignore");
      assert.equal(
        args.some((arg) => /insecure|ignore-tlog|ignore-sct|regexp/.test(arg)),
        false,
      );
    }
  });
  for (const command of ["verify", "verify-attestation"])
    it(`rejects any ${command} identity/signature/issuer failure`, () => {
      const cosign = cosignRunner(environment(), () => {}, command);
      assert.throws(
        () =>
          verifyPrCandidate({
            ...expectedFromEnv(environment()),
            run: cosign.run,
          }),
        /verification failed/,
      );
    });
  it("rejects wrong package or mutable image tag before invoking cosign", () => {
    for (const image of [
      `ghcr.io/thomasheinthura/taskdesk@${digest}`,
      `${environment().CANDIDATE_IMAGE}:edge`,
      `ghcr.io/thomasheinthura/taskdesk-pr-candidate-123-1@${digest}`,
    ]) {
      const cosign = cosignRunner();
      assert.throws(() =>
        verifyPrCandidate({
          ...expectedFromEnv(environment()),
          image,
          run: cosign.run,
        }),
      );
      assert.equal(cosign.calls.length, 0);
    }
  });
  for (const label of [
    "empty signatures",
    "wrong signature digest",
    "wrong signature annotation",
    "malformed envelope",
    "bad base64",
    "missing envelope",
    "wrong statement",
    "conflicting envelopes",
  ])
    it(`rejects ${label} despite successful command exit`, () => {
      const cosign = cosignRunner(environment(), (output, command) => {
        if (command === "verify") {
          if (label === "empty signatures") return [];
          if (label === "wrong signature digest")
            output[0].critical.image["docker-manifest-digest"] = "bad";
          if (label === "wrong signature annotation")
            output[0].optional.source_sha = main;
        } else {
          if (label === "malformed envelope") return "not json";
          if (label === "bad base64") output.payload = "%%%%";
          if (label === "missing envelope") return "";
          if (["wrong statement", "conflicting envelopes"].includes(label)) {
            const s = statement();
            s.predicate.sourceCommit = main;
            const bad = {
              ...output,
              payload: Buffer.from(JSON.stringify(s)).toString("base64"),
            };
            return label === "wrong statement"
              ? bad
              : `${JSON.stringify(output)}\n${JSON.stringify(bad)}`;
          }
        }
        return output;
      });
      assert.throws(() =>
        verifyPrCandidate({
          ...expectedFromEnv(environment()),
          run: cosign.run,
        }),
      );
    });
});
describe("workflow trust boundaries (static, not a dispatched build)", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/pr-candidate.yml", import.meta.url),
    "utf8",
  );
  const build = workflow.split("\n  build:\n")[1].split("\n  scan:\n")[0];
  const scanner = workflow.split("\n  scan:\n")[1].split("\n  publish:\n")[0];
  const publisher = workflow.split("\n  publish:\n")[1].split("\n  sign:\n")[0];
  const signer = workflow.split("\n  sign:\n")[1];
  it("keeps untrusted source out of credential-bearing jobs and grants OIDC only to signing", () => {
    assert.match(build, /ref: \$\{\{ needs\.resolve\.outputs\.source_sha \}\}/);
    assert.doesNotMatch(
      build,
      /packages: write|id-token: write|docker login|secrets\.|node scripts\//,
    );
    assert.equal((workflow.match(/id-token: write/g) || []).length, 1);
    for (const section of [scanner, publisher, signer]) {
      assert.match(section, /ref: \$\{\{ github\.sha \}\}/);
      assert.doesNotMatch(
        section,
        /ref: \$\{\{ needs\.resolve\.outputs\.source_sha/,
      );
    }
    assert.doesNotMatch(
      signer,
      /download-artifact|LAYOUT_DIR|docker (run|load)|pnpm|npm /,
    );
  });
  it("uses multiarch OCI build, same-origin frontend, exact artifact IDs and immutable scans", () => {
    assert.match(build, /platforms: linux\/amd64,linux\/arm64/);
    assert.match(build, /VITE_API_URL=\n/);
    assert.match(build, /push: false/);
    assert.match(build, /type=oci,.*tar=false/);
    assert.match(
      publisher,
      /artifact-ids: \$\{\{ needs\.build\.outputs\.artifact_id \}\}/,
    );
    assert.match(
      scanner,
      /--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --ignorefile \/dev\/null/,
    );
    assert.match(scanner, /--input "\$SCAN_DIR\/\$architecture"/);
    assert.doesNotMatch(scanner, /packages: write|id-token: write|GHCR_TOKEN/);
  });
  it("checks the resolver attempt before candidate checkout and rechecks refs immediately before signing", () => {
    assert.ok(
      build.indexOf("Refuse partial reruns") <
        build.indexOf("Check out exact resolved source"),
    );
    assert.match(
      build,
      /RESOLVED_RUN_ATTEMPT.*needs.resolve.outputs.run_attempt/,
    );
    assert.match(scanner, /BUILD_RUN_ATTEMPT.*needs.build.outputs.run_attempt/);
    assert.match(publisher, /SCAN_RUN_ATTEMPT.*needs.scan.outputs.run_attempt/);
    assert.match(
      signer,
      /PUBLISH_RUN_ATTEMPT.*needs.publish.outputs.run_attempt/,
    );
    assert.ok(
      signer.indexOf(
        "node scripts/ci/pr-candidate-policy.mjs revalidate-sign",
      ) < signer.indexOf("cosign sign --yes"),
    );
  });
  it("a failed scan stops the real scan shell and gates all publication/signing jobs", (t) => {
    assert.match(publisher, /needs: \[resolve, build, scan\]/);
    assert.match(signer, /needs: \[resolve, build, scan, publish\]/);
    assert.doesNotMatch(publisher + signer, /always\(|continue-on-error/);
    const section = scanner
      .split("      - name: Scan each immutable platform")[1]
      .split("\n      - name:")[0];
    const script = section
      .split("        run: |\n")[1]
      .split("\n")
      .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
      .join("\n");
    const directory = mkdtempSync(join(tmpdir(), "taskdesk-scan-failure-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const fake = join(directory, "trivy");
    writeFileSync(
      fake,
      '#!/bin/bash\nset -eu\necho "$*" >> "$TRACE"\ncase "$*" in *--severity*arm64*) exit 1;; esac\nwhile (( $# )); do if [[ "$1" == --output ]]; then shift; echo "synthetic SBOM" > "$1"; fi; shift; done\n',
      { mode: 0o700 },
    );
    const output = join(directory, "output");
    const trace = join(directory, "trace");
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        SCAN_DIR: join(directory, "views"),
        GITHUB_OUTPUT: output,
        TRACE: trace,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(readFileSync(output, "utf8"), /amd64_sbom_digest=sha256:/);
    assert.doesNotMatch(readFileSync(output, "utf8"), /arm64_sbom_digest/);
    assert.equal(readFileSync(trace, "utf8").trim().split("\n").length, 3);
  });
  it("has no automatic PR trigger or production release publication and pins all actions", () => {
    assert.doesNotMatch(
      workflow,
      /^ {2}(pull_request|push|pull_request_target):/m,
    );
    assert.doesNotMatch(
      workflow,
      /gh release|imagetools create|scripts\/deploy\.sh|release-source\/v1/,
    );
    for (const use of workflow.matchAll(/uses: ([^\s#]+)/g))
      assert.match(use[1], /@[0-9a-f]{40}$/);
  });
  it("keeps runner-only context out of job-level environment values", () => {
    let jobEnvironmentCount = 0;
    for (const section of workflow.split(/\n {2}[a-z][a-z-]*:\n/).slice(1)) {
      const jobEnvironment = section.match(/^ {4}env:\n((?:^ {6}.*\n)*)/m);
      if (!jobEnvironment) continue;
      jobEnvironmentCount++;
      assert.doesNotMatch(jobEnvironment[1], /\$\{\{\s*runner\./);
    }
    assert.ok(jobEnvironmentCount > 0);
    assert.equal(
      (signer.match(/^ {10}PREDICATE_PATH: \$\{\{ runner\.temp \}\}/gm) || [])
        .length,
      2,
    );
  });
});
