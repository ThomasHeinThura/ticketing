import { logTaskDesk } from "../instance/observability/runtime";

export function logRealtimeFailure(): void {
  logTaskDesk({
    module: "realtime",
    message: "realtime.failure",
    level: "error",
    result: "failed",
  });
}
