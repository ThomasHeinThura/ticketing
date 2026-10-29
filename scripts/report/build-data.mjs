// Rebuild counts from the current per-ID index, preserving maintained evidence.
// Usage: node scripts/report/build-data.mjs [legacy-audit-dir]
import {
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PHASES = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"];
const STATES = [
  "implemented_tested",
  "browser_verified",
  "implemented_untested",
  "partial",
  "missing",
  "external_blocked",
];

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function buildData(index, previous) {
  if (
    !isRecord(index) ||
    !Array.isArray(index.requirements) ||
    !index.requirements.length
  ) {
    throw new Error(
      "Requirement index must contain a nonempty requirements array",
    );
  }
  if (
    !isRecord(previous) ||
    !Array.isArray(previous.phases) ||
    previous.phases.length !== PHASES.length
  ) {
    throw new Error("Existing report must contain all seven phases P0–P6");
  }
  if (
    typeof previous.generated !== "string" ||
    !previous.generated ||
    !Array.isArray(previous.decisions) ||
    previous.decisions.some((item) => typeof item !== "string")
  ) {
    throw new Error("Invalid report generated timestamp or decisions");
  }
  for (const key of ["validation_runs", "crosscutting_gaps"]) {
    if (
      previous[key] != null &&
      (!Array.isArray(previous[key]) ||
        previous[key].some((item) => !isRecord(item)))
    )
      throw new Error(`Invalid report ${key}`);
  }
  if (
    previous.p6_goal != null &&
    (!isRecord(previous.p6_goal) || !Array.isArray(previous.p6_goal.goals))
  )
    throw new Error("Invalid report p6_goal");

  const phases = new Map();
  for (const phase of previous.phases) {
    if (
      !isRecord(phase) ||
      typeof phase.id !== "string" ||
      !PHASES.includes(phase.id) ||
      phases.has(phase.id)
    ) {
      throw new Error("Invalid or duplicate report phase");
    }
    if (!isRecord(phase.states)) {
      throw new Error(`Invalid states for ${phase.id}`);
    }
    if (
      phase.states_locked !== undefined &&
      typeof phase.states_locked !== "boolean"
    )
      throw new Error(`Invalid states_locked for ${phase.id}`);
    if (
      typeof phase.name !== "string" ||
      !phase.name ||
      !isRecord(phase.review) ||
      typeof phase.review.verdict !== "string"
    )
      throw new Error(`Invalid name or review for ${phase.id}`);
    if (phase.browser != null && !isRecord(phase.browser))
      throw new Error(`Invalid browser metadata for ${phase.id}`);
    if (
      phase.gates != null &&
      (!isRecord(phase.gates) ||
        (phase.gates.checks != null &&
          (!Array.isArray(phase.gates.checks) ||
            phase.gates.checks.some((item) => !isRecord(item)))))
    )
      throw new Error(`Invalid gates for ${phase.id}`);
    for (const key of ["carry", "remaining_summary"]) {
      if (
        phase[key] != null &&
        (!Array.isArray(phase[key]) ||
          phase[key].some((item) => typeof item !== "string"))
      )
        throw new Error(`Invalid ${key} for ${phase.id}`);
    }
    if (
      Object.keys(phase.states).some(
        (key) => !STATES.includes(key) && key !== "unaudited",
      )
    ) {
      throw new Error(`Unknown state count for ${phase.id}`);
    }
    phases.set(phase.id, {
      total: 0,
      unaudited: 0,
      states: Object.fromEntries(STATES.map((state) => [state, 0])),
    });
  }

  const ids = new Set();
  for (const requirement of index.requirements) {
    if (
      !isRecord(requirement) ||
      typeof requirement.id !== "string" ||
      !requirement.id.trim() ||
      ids.has(requirement.id)
    ) {
      throw new Error("Invalid or duplicate requirement ID");
    }
    ids.add(requirement.id);
    const counts = phases.get(requirement.phase);
    if (!counts) throw new Error(`Missing report phase for ${requirement.id}`);
    counts.total++;
    const verification =
      requirement.verification === "partial_local_evidence"
        ? "partial"
        : requirement.verification;
    if (verification === "unverified") counts.unaudited++;
    else if (STATES.includes(verification)) counts.states[verification]++;
    else throw new Error(`Unknown verification for ${requirement.id}`);
  }

  return {
    ...previous,
    phases: previous.phases.map((phase) => {
      const counts = phases.get(phase.id);
      if (!counts.total)
        throw new Error(`Missing requirements for ${phase.id}`);
      if (
        phase.states_locked === true &&
        (phase.total !== counts.total ||
          (phase.unaudited != null && phase.unaudited !== counts.unaudited) ||
          (phase.states.unaudited != null &&
            phase.states.unaudited !== counts.unaudited) ||
          (phase.browser?.verified != null &&
            phase.browser.verified !== counts.states.browser_verified) ||
          STATES.some(
            (state) => (phase.states[state] ?? 0) !== counts.states[state],
          ))
      ) {
        throw new Error(`Locked states conflict with index for ${phase.id}`);
      }
      return {
        ...phase,
        total: counts.total,
        states: { ...counts.states, unaudited: counts.unaudited },
        unaudited: counts.unaudited,
        ...(phase.browser != null || counts.states.browser_verified > 0
          ? {
              browser: {
                ...phase.browser,
                verified: counts.states.browser_verified,
              },
            }
          : {}),
      };
    }),
  };
}

function main() {
  if (process.argv.length > 3)
    throw new Error(
      "Usage: node scripts/report/build-data.mjs [legacy-audit-dir]",
    );
  if (process.argv[2] !== undefined) {
    if (!statSync(process.argv[2]).isDirectory())
      throw new Error("Legacy audit path must be a directory");
    console.warn(
      "Legacy audit directory is ignored; counts come from the per-ID requirement index.",
    );
  }
  const index = JSON.parse(
    readFileSync("docs/requirements-index.json", "utf8"),
  );
  const out = "docs/report/data.json";
  const previous = JSON.parse(readFileSync(out, "utf8"));
  const result = `${JSON.stringify(buildData(index, previous), null, "\t")}\n`;
  const temporary = `${out}.${process.pid}.tmp`;
  let created = false;
  try {
    writeFileSync(temporary, result, { flag: "wx" });
    created = true;
    renameSync(temporary, out);
  } catch (error) {
    if (created) {
      try {
        unlinkSync(temporary);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT")
          console.warn(
            "Could not remove the temporary report file after failure.",
          );
      }
    }
    throw error;
  }
  console.log(`wrote ${out}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
