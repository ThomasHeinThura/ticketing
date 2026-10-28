import {
  IMPORT_RUN_JOB,
  sweepRunningImportRuns,
} from "../imports/engine/runner";
import { sweepRunningSetupJobs } from "../imports/engine/setup-job";

export { IMPORT_RUN_JOB };

/**
 * `import-run` (background-jobs.md): on demand, per-run lease `import-run:<run id>` of 1 h.
 * `/execute` and `/resume` start a single run directly (resume also re-kicks a run left `running`).
 * The registered sweep handler is not clock-fired: there is no automatic restart recovery. The
 * runner executes AS the administrator who executed (or last resumed) the run and pauses it (never
 * continues as the system) when that authority is lost.
 *
 * The same job also owns the background setup step (source discovery, whole-run dry run) under the
 * per-run lease `import-setup:<run id>`; the sweep re-kicks a setup step left `running`, which
 * continues from its checkpoint.
 */
export async function runImportRunSweep() {
  const runs = await sweepRunningImportRuns();
  const setup = await sweepRunningSetupJobs();
  return {
    runs: runs.runs,
    chunks: runs.chunks,
    setupJobs: setup.runs,
    setupPages: setup.pages,
  };
}
