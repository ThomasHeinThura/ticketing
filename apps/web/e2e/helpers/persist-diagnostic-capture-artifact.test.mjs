import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  aggregateDiagnosticCapturesWithFailureReceipt,
  persistDiagnosticCaptureArtifact,
  persistDiagnosticCapturesBestEffort,
} from "./persist-diagnostic-capture-artifact.mjs";

const sourceAndBuild = {
  sourceCommitSha: "1e10c064faf984fbefe4ddb346d1e571524e4fc2",
  sourceTreeSha256: "f".repeat(64),
  manifestSha256: "e".repeat(64),
  canonicalFixtureSha256: "d".repeat(64),
};
const observedAlignmentError = new Error(
  "task-assignment option selection click-to-paint clock alignment was outside the monotonic-clock tolerance (scale=993.5797900735282).",
);

function fixture(index, name) {
  return {
    schemaVersion: 1,
    diagnosticOnly: true,
    captureIndex: index,
    sourceAndBuild,
    name,
    capturedWindow: {
      name,
      boundary: {
        startMark: "document-start",
        endMark: "board-paint",
        startPerformanceNowMs: 12,
        endPerformanceNowMs: 44,
        source: "fixture boundary",
      },
      clockMarks: [
        {
          name: "document-start",
          documentId: "0123456789abcdef",
          beforeMarkPerformanceNowMs: 12,
          afterMarkPerformanceNowMs: 12.01,
        },
        {
          name: "board-paint",
          documentId: "0123456789abcdef",
          beforeMarkPerformanceNowMs: 43.99,
          afterMarkPerformanceNowMs: 44,
        },
      ],
      traceCpuProfiles: [
        {
          nodes: [
            {
              id: 1,
              functionName: "Board",
              asset: "board.js",
              line: 8,
              column: 2,
            },
          ],
          samples: [
            { nodeId: 1, startMicroseconds: 1_000, durationMicroseconds: 500 },
          ],
        },
      ],
    },
  };
}

function makeCaptures() {
  return [
    fixture(1, "initial work-list navigation to LCP"),
    fixture(2, "task-state option selection click-to-paint"),
    fixture(3, "task-assignment option selection click-to-paint"),
    fixture(4, "board navigation to all 200 cards rendered"),
    fixture(5, "board task selection opens editor and Escape closes sheet"),
  ];
}

function aggregateFixtureWindow(capture) {
  if (capture.name === "task-assignment option selection click-to-paint")
    throw observedAlignmentError;
  return { name: capture.name };
}

test("pre-alignment persistence retains captures and original failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "g11-capture-checkpoint-"));
  try {
    const captures = makeCaptures();

    // The old aggregation-first control fails before it reaches any writer.
    const oldPath = path.join(root, "old-order");
    assert.throws(
      () => captures.map(aggregateFixtureWindow),
      (error) => error === observedAlignmentError,
    );
    await assert.rejects(readdir(oldPath), { code: "ENOENT" });

    // The proposed ordering checkpoints all five sanitized captures first.
    const candidatePath = path.join(root, "checkpoint-first");
    await persistDiagnosticCapturesBestEffort(candidatePath, captures);
    await assert.rejects(
      aggregateDiagnosticCapturesWithFailureReceipt(
        candidatePath,
        captures,
        sourceAndBuild,
        aggregateFixtureWindow,
      ),
      (error) => error === observedAlignmentError,
    );
    assert.deepEqual((await readdir(candidatePath)).sort(), [
      "alignment-failure.json",
      "window-01.json",
      "window-02.json",
      "window-03.json",
      "window-04.json",
      "window-05.json",
    ]);
    const board = JSON.parse(
      await readFile(path.join(candidatePath, "window-04.json"), "utf8"),
    );
    assert.equal(
      board.sourceAndBuild.sourceCommitSha,
      sourceAndBuild.sourceCommitSha,
    );
    assert.equal(board.capturedWindow.clockMarks[1].name, "board-paint");
    assert.equal(
      board.capturedWindow.traceCpuProfiles[0].samples[0].durationMicroseconds,
      500,
    );
    const failure = JSON.parse(
      await readFile(
        path.join(candidatePath, "alignment-failure.json"),
        "utf8",
      ),
    );
    assert.equal(
      failure.failedCaptureName,
      "task-assignment option selection click-to-paint",
    );
    assert.equal(failure.errorMessage, observedAlignmentError.message);
    assert.equal(
      (await stat(path.join(candidatePath, "window-04.json"))).mode & 0o777,
      0o600,
    );

    // Existing evidence remains protected from accidental overwrite.
    await assert.rejects(
      persistDiagnosticCaptureArtifact(candidatePath, 4, captures[3]),
      { code: "EEXIST" },
    );
    assert.equal(
      JSON.parse(
        await readFile(path.join(candidatePath, "window-04.json"), "utf8"),
      ).captureIndex,
      4,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture and failure write errors do not replace the original alignment error", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "g11-capture-write-failure-"),
  );
  const originalError = new Error(observedAlignmentError.message);
  try {
    const directoryThatIsAFile = path.join(root, "not-a-directory");
    await writeFile(directoryThatIsAFile, "block mkdir");
    const captures = makeCaptures();
    const errors = [];
    const originalConsoleError = console.error;
    console.error = (...values) => errors.push(values);
    try {
      await persistDiagnosticCapturesBestEffort(directoryThatIsAFile, captures);
      await assert.rejects(
        aggregateDiagnosticCapturesWithFailureReceipt(
          directoryThatIsAFile,
          captures,
          sourceAndBuild,
          (capture) => {
            if (
              capture.name === "task-assignment option selection click-to-paint"
            )
              throw originalError;
            return { name: capture.name };
          },
        ),
        (error) => error === originalError,
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(errors.length, captures.length + 1);
    assert.equal(
      errors.at(-1)[0],
      "Could not persist the diagnostic alignment failure context:",
    );
    await assert.rejects(readdir(directoryThatIsAFile), { code: "ENOTDIR" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
