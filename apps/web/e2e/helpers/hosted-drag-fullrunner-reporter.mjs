import { chmod, mkdir, writeFile } from "node:fs/promises";
import { FULLRUNNER_RESULT_DIRECTORY } from "./hosted-drag-fullrunner-evidence.mjs";

const RESULT_DIRECTORY = FULLRUNNER_RESULT_DIRECTORY;
const RESULT_FILENAME = `${RESULT_DIRECTORY}/runner-evidence.json`;

function numericList(value) {
  const values = value.split(",").map((part) => Number(part.trim()));
  return values.length > 0 &&
    values.length <= 100 &&
    values.every(Number.isFinite)
    ? values
    : undefined;
}

function decimal(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export default class HostedDragFullrunnerReporter {
  constructor() {
    this.plannedTests = 0;
    this.outcomes = [];
    this.testOrdinals = new Map();
    this.calibration = { batches: [], factors: [] };
    this.runtime = {};
    this.stdoutTail = "";
    this.runnerStatus = "unknown";
  }

  printsToStdio() {
    return false;
  }

  onBegin(_config, suite) {
    const tests = suite.allTests();
    this.plannedTests = tests.length;
    tests.forEach((testCase, index) => {
      this.testOrdinals.set(testCase.id, index + 1);
    });
  }

  onStdOut(chunk) {
    const text = this.stdoutTail + chunk.toString();
    const lines = text.split(/\r?\n/);
    this.stdoutTail = lines.pop() ?? "";
    for (const line of lines) this.#observeLine(line);
  }

  #observeLine(line) {
    const host = /^G11 host: cpu model (.{1,100}); nproc ([0-9]{1,4})$/.exec(
      line,
    );
    if (host) {
      this.runtime.cpuModel = host[1];
      this.runtime.logicalCpuCount = Number(host[2]);
      return;
    }
    const chromium =
      /^G11 private fullrunner Chromium: ([A-Za-z0-9.v+-]{1,64})$/.exec(line);
    if (chromium) {
      this.runtime.chromiumVersion = chromium[1];
      return;
    }
    const batch =
      /^G11 calibration job batch ([1-6]) \[(unthrottled|throttled)\]: runs \(([^)]*)\); median ([0-9]+(?:\.[0-9]+)?); spread ([0-9]+(?:\.[0-9]+)?)$/.exec(
        line,
      );
    if (batch) {
      const runs = numericList(batch[3]);
      const medianMs = decimal(batch[4]);
      const spread = decimal(batch[5]);
      if (runs && medianMs !== undefined && spread !== undefined)
        this.calibration.batches.push({
          batch: Number(batch[1]),
          state: batch[2],
          runs,
          medianMs,
          spread,
        });
      return;
    }
    const factor =
      /^G11 calibration job \[(unthrottled|throttled)\]: mode (calibrated|raw); median of batch medians ([0-9]+(?:\.[0-9]+)?); max spread ([0-9]+(?:\.[0-9]+)?); R0 (unpinned|[0-9]+(?:\.[0-9]+)?); factor ([0-9]+(?:\.[0-9]+)?)(?: \(not applied\))?(?:; note .*)?$/.exec(
        line,
      );
    if (factor) {
      this.calibration.factors.push({
        state: factor[1],
        mode: factor[2],
        medianOfBatchMediansMs: Number(factor[3]),
        maxSpread: Number(factor[4]),
        referenceMs: factor[5] === "unpinned" ? null : Number(factor[5]),
        factor: Number(factor[6]),
      });
    }
  }

  onTestEnd(testCase, result) {
    this.outcomes.push({
      ordinal: this.testOrdinals.get(testCase.id) ?? this.outcomes.length + 1,
      title: testCase.title,
      status: result.status ?? "interrupted",
      expectedStatus: testCase.expectedStatus,
      retry: result.retry,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
      durationMs: result.duration,
    });
  }

  async onEnd(result) {
    if (this.stdoutTail) this.#observeLine(this.stdoutTail);
    this.runnerStatus = result.status;
    await mkdir(RESULT_DIRECTORY, { recursive: true, mode: 0o700 });
    await chmod(RESULT_DIRECTORY, 0o700);
    await writeFile(
      RESULT_FILENAME,
      `${JSON.stringify({
        plannedTests: this.plannedTests,
        outcomes: this.outcomes.sort(
          (left, right) => left.ordinal - right.ordinal,
        ),
        calibration: this.calibration,
        runtime: this.runtime,
        runnerStatus: this.runnerStatus,
      })}\n`,
      { encoding: "utf8", flag: "w", mode: 0o600 },
    );
    await chmod(RESULT_FILENAME, 0o600);
  }
}
