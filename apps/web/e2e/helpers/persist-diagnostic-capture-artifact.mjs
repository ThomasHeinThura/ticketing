import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CAPTURE_COUNT = 5;

function assertSourceBinding(sourceAndBuild) {
  if (!sourceAndBuild || typeof sourceAndBuild !== "object")
    throw new TypeError("A source-bound diagnostic artifact is required.");
  for (const key of [
    "sourceCommitSha",
    "sourceTreeSha256",
    "manifestSha256",
    "canonicalFixtureSha256",
  ]) {
    if (typeof sourceAndBuild[key] !== "string")
      throw new TypeError(`Diagnostic source binding is missing ${key}.`);
  }
}

async function writePrivateJsonOnce(directory, filename, artifact) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const destination = path.join(directory, filename);
  await writeFile(destination, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return destination;
}

export async function persistDiagnosticCaptureArtifact(
  directory,
  captureIndex,
  artifact,
) {
  if (
    !Number.isInteger(captureIndex) ||
    captureIndex < 1 ||
    captureIndex > CAPTURE_COUNT
  )
    throw new RangeError(
      "Diagnostic capture index is outside the five fixed windows.",
    );
  if (
    artifact?.schemaVersion !== 1 ||
    artifact?.diagnosticOnly !== true ||
    artifact?.captureIndex !== captureIndex
  )
    throw new TypeError(
      "Diagnostic capture artifact metadata does not match its fixed window.",
    );
  assertSourceBinding(artifact.sourceAndBuild);
  if (typeof artifact.capturedWindow?.name !== "string")
    throw new TypeError("Diagnostic capture artifact has no window name.");
  return writePrivateJsonOnce(
    directory,
    `window-${String(captureIndex).padStart(2, "0")}.json`,
    artifact,
  );
}

export async function persistDiagnosticFailureArtifact(directory, artifact) {
  if (
    artifact?.schemaVersion !== 1 ||
    artifact?.diagnosticOnly !== true ||
    artifact?.phase !== "align-boundary-to-trace"
  )
    throw new TypeError("Diagnostic failure artifact metadata is invalid.");
  assertSourceBinding(artifact.sourceAndBuild);
  if (
    typeof artifact.errorMessage !== "string" ||
    !Array.isArray(artifact.completedCaptureNames)
  )
    throw new TypeError(
      "Diagnostic failure artifact lacks bounded alignment context.",
    );
  return writePrivateJsonOnce(directory, "alignment-failure.json", artifact);
}

export async function persistDiagnosticCapturesBestEffort(
  directory,
  artifacts,
) {
  for (const artifact of artifacts) {
    try {
      await persistDiagnosticCaptureArtifact(
        directory,
        artifact.captureIndex,
        artifact,
      );
    } catch (checkpointError) {
      console.error(
        `Could not persist diagnostic capture window ${artifact.captureIndex}:`,
        checkpointError,
      );
    }
  }
}

export async function aggregateDiagnosticCapturesWithFailureReceipt(
  directory,
  captures,
  sourceAndBuild,
  aggregate,
) {
  let activeCapture;
  try {
    return captures.map((capture) => {
      activeCapture = capture;
      return aggregate(capture);
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Non-Error alignment failure";
    try {
      await persistDiagnosticFailureArtifact(directory, {
        schemaVersion: 1,
        diagnosticOnly: true,
        phase: "align-boundary-to-trace",
        sourceAndBuild,
        failedCaptureName: activeCapture?.name ?? "unknown",
        completedCaptureNames: captures.map(({ name }) => name),
        errorMessage,
      });
    } catch (checkpointError) {
      console.error(
        "Could not persist the diagnostic alignment failure context:",
        checkpointError,
      );
    }
    throw error;
  }
}
