import { fileURLToPath } from "node:url";

// One fail-closed aggregator for every sharded gate (unit, static, integration, e2e).
// The workflow passes `toJSON(needs)` and the exact job list it expects; the run fails on
// an empty list, an empty `needs`, and any missing, extra, failed, cancelled or skipped job.
export function assertGateJobs(results, expected, label = "gate") {
  if (
    !Array.isArray(expected) ||
    expected.length === 0 ||
    expected.some((job) => typeof job !== "string" || job === "") ||
    new Set(expected).size !== expected.length
  ) {
    throw new Error(`Missing ${label} expected job list`);
  }
  if (
    !results ||
    typeof results !== "object" ||
    Array.isArray(results) ||
    Object.keys(results).length === 0
  ) {
    throw new Error(`Missing ${label} job results`);
  }
  const keys = Object.keys(results).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...expected].sort())) {
    throw new Error(
      `${label} requires exactly the named jobs: ${expected.join(", ")}`,
    );
  }
  for (const job of expected) {
    if (results[job]?.result !== "success") {
      throw new Error(
        `${job} did not succeed: ${results[job]?.result ?? "missing"}`,
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const list = process.env.GATE_EXPECTED_JOBS;
    const label = process.env.GATE_LABEL || "gate";
    const expected = list ? list.split(",").map((job) => job.trim()) : null;
    assertGateJobs(
      JSON.parse(process.env.GATE_JOB_RESULTS ?? "null"),
      expected,
      label,
    );
    console.log(`All ${expected?.length} ${label} jobs passed`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
