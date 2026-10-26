import {
  IMPORT_RUN_JOB,
  sweepRunningImportRuns,
} from "../imports/engine/runner";

export { IMPORT_RUN_JOB };

/**
 * `import-run` (background-jobs.md): on demand, per-run lease `import-run:<run id>` of 1 h.
 * `/execute` and `/resume` start a single run directly (resume also re-kicks a run left `running`).
 * The registered sweep handler is not clock-fired: there is no automatic restart recovery. The
 * runner executes AS the run's starter and pauses the run (never continues as the system) when
 * that authority is lost.
 */
export async function runImportRunSweep() {
  return sweepRunningImportRuns();
}
