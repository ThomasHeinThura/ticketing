/** Trusted-main policy helpers. Never load helpers from the selected source tree. */
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_PREDICATE,
  CANDIDATE_PURPOSE,
  CANDIDATE_REPOSITORY,
  CANDIDATE_WORKFLOW,
  candidateCoordinates,
  validateCandidateExpectation,
  validateCandidateStatement,
} from "../../deploy/pr-candidate-attestation.mjs";

const fail = (message) => {
  throw new Error(`Candidate policy: ${message}`);
};
export function expectedFromEnv(env) {
  return {
    image: `${env.CANDIDATE_IMAGE}@${env.CANDIDATE_DIGEST}`,
    sourceRef: env.SOURCE_REF,
    sourceSha: env.SOURCE_SHA,
    targetMainSha: env.TARGET_MAIN_SHA,
    policySha: env.POLICY_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    pullRequest: env.PULL_REQUEST ? Number(env.PULL_REQUEST) : null,
  };
}
export function writeOutputs(values, file) {
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-z_]+$/.test(key) || /[\r\n\0]/.test(String(value)))
      fail("invalid job output.");
    appendFileSync(file, `${key}=${value}\n`);
  }
}
export function resolveCandidate(env, run = spawnSync) {
  if (
    env.GITHUB_REPOSITORY !== CANDIDATE_REPOSITORY ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_WORKFLOW_REF !==
      `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@refs/heads/main`
  )
    fail("issuance requires a manual dispatch of the trusted main workflow.");
  if (
    env.GITHUB_SHA !== env.INPUT_TARGET_MAIN_SHA ||
    env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
  )
    fail("target main must equal the trusted dispatch/workflow commit.");
  const sourceRef = `refs/heads/${env.INPUT_SOURCE_BRANCH}`;
  const coordinates = candidateCoordinates({
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    sourceSha: env.INPUT_SOURCE_SHA,
  });
  const pullRequest = env.INPUT_PULL_REQUEST
    ? Number(env.INPUT_PULL_REQUEST)
    : null;
  if (env.INPUT_PULL_REQUEST && String(pullRequest) !== env.INPUT_PULL_REQUEST)
    fail("pull request must be a canonical positive integer.");
  validateCandidateExpectation({
    image: `${coordinates.name}@sha256:${"0".repeat(64)}`,
    sourceRef,
    sourceSha: env.INPUT_SOURCE_SHA,
    targetMainSha: env.INPUT_TARGET_MAIN_SHA,
    policySha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    pullRequest,
  });
  const api = (endpoint) => {
    const result = run(
      "gh",
      ["api", `repos/${CANDIDATE_REPOSITORY}/${endpoint}`],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      },
    );
    if (result.error || result.status !== 0)
      fail("GitHub ref resolution failed.");
    try {
      return JSON.parse(result.stdout);
    } catch {
      return fail("GitHub response is invalid JSON.");
    }
  };
  // Resolve the immutable selection; later guards only check for drift.
  const main = api("git/ref/heads/main");
  const head = api(
    `git/ref/heads/${env.INPUT_SOURCE_BRANCH.split("/").map(encodeURIComponent).join("/")}`,
  );
  if (
    main.ref !== "refs/heads/main" ||
    main.object?.type !== "commit" ||
    main.object.sha !== env.INPUT_TARGET_MAIN_SHA
  )
    fail("main moved or target main does not match.");
  if (
    head.ref !== sourceRef ||
    head.object?.type !== "commit" ||
    head.object.sha !== env.INPUT_SOURCE_SHA
  )
    fail("feature branch moved or source SHA does not match its exact head.");
  if (head.object.sha === main.object.sha)
    fail("candidate source must differ from main.");
  if (pullRequest !== null) {
    const pr = api(`pulls/${pullRequest}`);
    if (
      pr.number !== pullRequest ||
      pr.state !== "open" ||
      pr.head?.repo?.full_name !== CANDIDATE_REPOSITORY ||
      pr.base?.repo?.full_name !== CANDIDATE_REPOSITORY ||
      pr.head.ref !== env.INPUT_SOURCE_BRANCH ||
      pr.head.sha !== env.INPUT_SOURCE_SHA ||
      pr.base.ref !== "main" ||
      pr.base.sha !== env.INPUT_TARGET_MAIN_SHA
    )
      fail(
        "PR must be open and bind the exact same-repository head and main base.",
      );
  }
  const commit = api(`git/commits/${env.INPUT_SOURCE_SHA}`);
  if (
    commit.sha !== env.INPUT_SOURCE_SHA ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(commit.committer?.date || "")
  )
    fail("source commit date could not be established.");
  return {
    source_ref: sourceRef,
    source_sha: env.INPUT_SOURCE_SHA,
    target_main_sha: env.INPUT_TARGET_MAIN_SHA,
    policy_sha: env.GITHUB_SHA,
    pull_request: pullRequest ?? "",
    image: coordinates.name,
    tag: coordinates.tag,
    source_date: commit.committer.date,
    run_id: env.GITHUB_RUN_ID,
    run_attempt: env.GITHUB_RUN_ATTEMPT,
  };
}
/** Every producer must belong to this exact run attempt. Revalidation only
 * compares live refs with the frozen selection; it never chooses a new source. */
export function validateCandidateStage(env, producers, run = spawnSync) {
  for (const producer of ["RESOLVED", ...producers]) {
    if (
      !/^[1-9][0-9]{0,19}$/.test(env[`${producer}_RUN_ID`] || "") ||
      !/^[1-9][0-9]{0,19}$/.test(env[`${producer}_RUN_ATTEMPT`] || "") ||
      env[`${producer}_RUN_ID`] !== env.GITHUB_RUN_ID ||
      env[`${producer}_RUN_ATTEMPT`] !== env.GITHUB_RUN_ATTEMPT
    )
      fail(
        `${producer.toLowerCase()} run attempt does not match; rerun all jobs.`,
      );
  }
  validateCandidateExpectation(expectedFromEnv(env));
  const checked = resolveCandidate(
    {
      ...env,
      INPUT_SOURCE_BRANCH: env.SOURCE_REF.slice("refs/heads/".length),
      INPUT_SOURCE_SHA: env.SOURCE_SHA,
      INPUT_TARGET_MAIN_SHA: env.TARGET_MAIN_SHA,
      INPUT_PULL_REQUEST: env.PULL_REQUEST || "",
    },
    run,
  );
  if (
    checked.image !== env.CANDIDATE_IMAGE ||
    checked.policy_sha !== env.POLICY_SHA
  )
    fail("frozen image or policy no longer matches its authority.");
  return { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT };
}
export function candidatePredicate(env) {
  const expected = expectedFromEnv(env);
  const coordinates = validateCandidateExpectation(expected);
  const predicate = {
    schemaVersion: 1,
    purpose: CANDIDATE_PURPOSE,
    productionEligible: false,
    sourceRepository: CANDIDATE_REPOSITORY,
    sourceRef: expected.sourceRef,
    sourceCommit: expected.sourceSha,
    targetMainCommit: expected.targetMainSha,
    policy: {
      repository: CANDIDATE_REPOSITORY,
      workflow: CANDIDATE_WORKFLOW,
      ref: "refs/heads/main",
      commit: expected.policySha,
    },
    image: {
      name: coordinates.name,
      digest: coordinates.digest,
      tag: coordinates.tag,
      platforms: {
        "linux/amd64": env.AMD64_DIGEST,
        "linux/arm64": env.ARM64_DIGEST,
      },
    },
    run: {
      id: expected.runId,
      attempt: expected.runAttempt,
      url: coordinates.runUrl,
      event: "workflow_dispatch",
    },
    pullRequest: expected.pullRequest,
    buildArtifact: {
      id: env.BUILD_ARTIFACT_ID,
      digest: `sha256:${env.BUILD_ARTIFACT_DIGEST}`,
    },
    scan: {
      scanner: "trivy",
      version: "0.73.0",
      severity: ["HIGH", "CRITICAL"],
      ignoreUnfixed: true,
      result: "passed",
    },
    sboms: {
      "linux/amd64": env.AMD64_SBOM_DIGEST,
      "linux/arm64": env.ARM64_SBOM_DIGEST,
    },
  };
  validateCandidateStatement(
    {
      _type: "https://in-toto.io/Statement/v0.1",
      subject: [
        {
          name: coordinates.name,
          digest: { sha256: coordinates.digest.slice(7) },
        },
      ],
      predicateType: CANDIDATE_PREDICATE,
      predicate,
    },
    expected,
  );
  return predicate;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const env = process.env;
    if (process.argv[2] === "resolve" && process.argv.length === 3)
      writeOutputs(resolveCandidate(process.env), env.GITHUB_OUTPUT);
    else if (process.argv[2] === "predicate" && process.argv.length === 3) {
      validateCandidateStage(env, ["BUILD", "SCAN", "PUBLISH"]);
      writeFileSync(
        env.PREDICATE_PATH,
        `${JSON.stringify(candidatePredicate(process.env), null, 2)}\n`,
        { flag: "wx" },
      );
    } else if (
      process.argv[2] === "revalidate-sign" &&
      process.argv.length === 3
    )
      validateCandidateStage(env, ["BUILD", "SCAN", "PUBLISH"]);
    else fail("expected resolve, predicate or revalidate-sign.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
