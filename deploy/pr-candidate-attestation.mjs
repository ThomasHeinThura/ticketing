/** Candidate trust is deliberately separate from the production release identity.
 * This module never deploys, pulls images, or accepts an unverified JSON file. */
import { spawnSync } from "node:child_process";

export const CANDIDATE_REPOSITORY = "ThomasHeinThura/ticketing";
export const CANDIDATE_WORKFLOW = ".github/workflows/pr-candidate.yml";
export const CANDIDATE_ISSUER = "https://token.actions.githubusercontent.com";
export const CANDIDATE_IDENTITY = `https://github.com/${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@refs/heads/main`;
export const CANDIDATE_PREDICATE = `https://github.com/${CANDIDATE_REPOSITORY}/attestations/pr-candidate/v1`;
export const CANDIDATE_PURPOSE = "local-sit-pr-candidate";
const sha = /^[0-9a-f]{40}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const id = /^[1-9][0-9]{0,19}$/;
const fail = (message) => {
  throw new Error(`PR candidate rejected: ${message}`);
};
const same = (actual, expected, label) => {
  if (actual !== expected) fail(`${label} mismatch.`);
};
function keys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  )
    fail(`${label} schema is invalid.`);
}
export function candidateCoordinates({ runId, runAttempt, sourceSha }) {
  if (
    typeof runId !== "string" ||
    typeof runAttempt !== "string" ||
    typeof sourceSha !== "string" ||
    !id.test(runId) ||
    !id.test(runAttempt) ||
    !sha.test(sourceSha)
  )
    fail("run, attempt and source must be exact immutable identifiers.");
  return {
    name: `ghcr.io/thomasheinthura/taskdesk-pr-candidate-${runId}-${runAttempt}`,
    tag: `candidate-${runId}-${runAttempt}-sha-${sourceSha}`,
    runUrl: `https://github.com/${CANDIDATE_REPOSITORY}/actions/runs/${runId}/attempts/${runAttempt}`,
  };
}
export function validateCandidateExpectation(expected) {
  const {
    sourceRef,
    sourceSha,
    targetMainSha,
    policySha,
    runId,
    runAttempt,
    image,
    pullRequest = null,
  } = expected;
  const coordinates = candidateCoordinates({ runId, runAttempt, sourceSha });
  // Reject Git revision syntax, traversal, option-like names and control characters.
  if (
    typeof sourceRef !== "string" ||
    !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(sourceRef) ||
    sourceRef.includes("..") ||
    sourceRef.includes("//") ||
    sourceRef.endsWith("/") ||
    sourceRef
      .split("/")
      .some(
        (part) =>
          part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"),
      ) ||
    sourceRef === "refs/heads/main" ||
    sourceRef.startsWith("refs/heads/release/")
  )
    fail("source must be a feature branch ref.");
  if (
    !sha.test(targetMainSha) ||
    !sha.test(policySha) ||
    targetMainSha !== policySha
  )
    fail("target main and trusted workflow policy must be the same full SHA.");
  if (sourceSha === targetMainSha)
    fail("candidate source must differ from main.");
  if (
    pullRequest !== null &&
    (!Number.isSafeInteger(pullRequest) || pullRequest < 1)
  )
    fail("pull request must be a positive integer or null.");
  if (
    typeof image !== "string" ||
    !image.startsWith(`${coordinates.name}@`) ||
    !digest.test(image.slice(coordinates.name.length + 1))
  )
    fail("image must pin the exact run-specific candidate package by digest.");
  return {
    ...coordinates,
    digest: image.slice(coordinates.name.length + 1),
    pullRequest,
  };
}
export function validateCandidateStatement(statement, expected) {
  const coordinates = validateCandidateExpectation(expected);
  keys(
    statement,
    ["_type", "subject", "predicateType", "predicate"],
    "statement",
  );
  if (
    ![
      "https://in-toto.io/Statement/v0.1",
      "https://in-toto.io/Statement/v1",
    ].includes(statement._type)
  )
    fail("unsupported in-toto statement.");
  same(statement.predicateType, CANDIDATE_PREDICATE, "predicate type");
  if (!Array.isArray(statement.subject) || statement.subject.length !== 1)
    fail("exactly one subject is required.");
  const subject = statement.subject[0];
  keys(subject, ["name", "digest"], "subject");
  keys(subject.digest, ["sha256"], "subject digest");
  same(subject.name, coordinates.name, "subject package");
  same(`sha256:${subject.digest.sha256}`, coordinates.digest, "subject digest");
  const p = statement.predicate;
  keys(
    p,
    [
      "schemaVersion",
      "purpose",
      "productionEligible",
      "sourceRepository",
      "sourceRef",
      "sourceCommit",
      "targetMainCommit",
      "policy",
      "image",
      "run",
      "pullRequest",
      "buildArtifact",
      "scan",
      "sboms",
    ],
    "predicate",
  );
  same(p.schemaVersion, 1, "schema version");
  same(p.purpose, CANDIDATE_PURPOSE, "purpose");
  same(p.productionEligible, false, "production eligibility");
  same(p.sourceRepository, CANDIDATE_REPOSITORY, "source repository");
  same(p.sourceRef, expected.sourceRef, "source ref");
  same(p.sourceCommit, expected.sourceSha, "source commit");
  same(p.targetMainCommit, expected.targetMainSha, "target main");
  same(p.pullRequest, coordinates.pullRequest, "pull request");
  keys(p.policy, ["repository", "workflow", "ref", "commit"], "policy");
  same(p.policy.repository, CANDIDATE_REPOSITORY, "policy repository");
  same(p.policy.workflow, CANDIDATE_WORKFLOW, "policy workflow");
  same(p.policy.ref, "refs/heads/main", "policy ref");
  same(p.policy.commit, expected.policySha, "policy commit");
  keys(p.image, ["name", "digest", "tag", "platforms"], "image");
  same(p.image.name, coordinates.name, "image package");
  same(p.image.digest, coordinates.digest, "image digest");
  same(p.image.tag, coordinates.tag, "image tag");
  keys(p.image.platforms, ["linux/amd64", "linux/arm64"], "image platforms");
  for (const value of Object.values(p.image.platforms))
    if (!digest.test(value)) fail("platform digest is invalid.");
  if (
    new Set([coordinates.digest, ...Object.values(p.image.platforms)]).size !==
    3
  )
    fail("platform/index digests must be distinct.");
  keys(p.run, ["id", "attempt", "url", "event"], "run");
  same(p.run.id, expected.runId, "run id");
  same(p.run.attempt, expected.runAttempt, "run attempt");
  same(p.run.url, coordinates.runUrl, "run URL");
  same(p.run.event, "workflow_dispatch", "trigger");
  keys(p.buildArtifact, ["id", "digest"], "build artifact");
  if (!id.test(p.buildArtifact.id) || !digest.test(p.buildArtifact.digest))
    fail("build artifact binding is invalid.");
  keys(
    p.scan,
    ["scanner", "version", "severity", "ignoreUnfixed", "result"],
    "scan",
  );
  same(p.scan.scanner, "trivy", "scanner");
  same(p.scan.version, "0.73.0", "scanner version");
  if (
    !Array.isArray(p.scan.severity) ||
    p.scan.severity.join(",") !== "HIGH,CRITICAL"
  )
    fail("scan severities mismatch.");
  same(p.scan.ignoreUnfixed, true, "scan fix policy");
  same(p.scan.result, "passed", "scan result");
  keys(p.sboms, ["linux/amd64", "linux/arm64"], "SBOMs");
  for (const value of Object.values(p.sboms))
    if (!digest.test(value)) fail("SBOM digest is invalid.");
  return structuredClone(p);
}
function verifiedJson(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    fail(`${label} output is invalid JSON.`);
  }
}
/** Trust expected values supplied independently by the operator, never values learned
 * from a candidate's own label, tag, attestation, or mutable branch after issuance. */
export function verifyPrCandidate({ run = spawnSync, ...expected }) {
  const coordinates = validateCandidateExpectation(expected);
  const invoke = (args, label) => {
    const result = run("cosign", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      fail(`${label} verification failed.`);
    return result.stdout || "";
  };
  const identity = [
    "--certificate-oidc-issuer",
    CANDIDATE_ISSUER,
    "--certificate-identity",
    CANDIDATE_IDENTITY,
    "--certificate-github-workflow-repository",
    CANDIDATE_REPOSITORY,
    "--certificate-github-workflow-ref",
    "refs/heads/main",
    "--certificate-github-workflow-sha",
    expected.policySha,
    "--certificate-github-workflow-trigger",
    "workflow_dispatch",
  ];
  const signatures = verifiedJson(
    invoke(
      [
        "verify",
        ...identity,
        "--output",
        "json",
        "--annotations",
        `purpose=${CANDIDATE_PURPOSE}`,
        "--annotations",
        `source_sha=${expected.sourceSha}`,
        "--annotations",
        `tag=${coordinates.tag}`,
        "--annotations",
        `workflow_run=${coordinates.runUrl}`,
        expected.image,
      ],
      "signature",
    ),
    "signature",
  );
  if (!Array.isArray(signatures) || !signatures.length)
    fail("verified signature is absent.");
  for (const signature of signatures) {
    same(
      signature.critical?.identity?.["docker-reference"],
      coordinates.name,
      "signature package",
    );
    same(
      signature.critical?.image?.["docker-manifest-digest"],
      coordinates.digest,
      "signature digest",
    );
    for (const [key, value] of Object.entries({
      purpose: CANDIDATE_PURPOSE,
      source_sha: expected.sourceSha,
      tag: coordinates.tag,
      workflow_run: coordinates.runUrl,
    }))
      same(signature.optional?.[key], value, `signature ${key}`);
  }
  const output = invoke(
    [
      "verify-attestation",
      ...identity,
      "--type",
      CANDIDATE_PREDICATE,
      "--output",
      "json",
      expected.image,
    ],
    "attestation",
  ).trim();
  if (!output) fail("verified attestation is absent.");
  // cosign emits one compact JSON envelope per line, not one JSON array.
  const envelopes = output
    .split(/\r?\n/)
    .map((line) => verifiedJson(line, "attestation"));
  let predicate;
  for (const envelope of envelopes) {
    if (
      envelope.payloadType !== "application/vnd.in-toto+json" ||
      typeof envelope.payload !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        envelope.payload,
      )
    )
      fail("attestation envelope is invalid.");
    const statement = verifiedJson(
      Buffer.from(envelope.payload, "base64").toString("utf8"),
      "statement",
    );
    const next = validateCandidateStatement(statement, expected);
    if (predicate && JSON.stringify(predicate) !== JSON.stringify(next))
      fail("conflicting verified attestations.");
    predicate = next;
  }
  return predicate;
}
