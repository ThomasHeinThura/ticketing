import { useQuery } from "@tanstack/react-query";
import {
  type EngineRun,
  getEngineImportRun,
} from "@/fetchers/god-mode/imports";
import { wizardKeys } from "./wizard-keys";

export const ENGINE_POLL_MS = 3000;

/** True while something is still moving: a running import, or an approval not yet granted. */
export function engineRunIsLive(run: EngineRun | undefined): boolean {
  if (!run) return false;
  if (run.state === "running" || run.state === "queued") {
    return run.phase === "executing" || run.state === "running";
  }
  return (
    run.approval.pendingActionId !== null &&
    run.approval.required &&
    !run.approval.approved
  );
}

/** The engine DTO, polled every few seconds while the run is live. */
export function useEngineRun(runId: string) {
  return useQuery({
    queryKey: wizardKeys.engine(runId),
    queryFn: () => getEngineImportRun(runId),
    refetchInterval: (query) =>
      engineRunIsLive(query.state.data) ? ENGINE_POLL_MS : false,
    retry: false,
  });
}
