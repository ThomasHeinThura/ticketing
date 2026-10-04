import { logTaskDesk } from "./runtime";

/** Record an HTTP process lifecycle failure without serializing the underlying error. */
export function logHttpLifecycleFailure(): void {
  logTaskDesk({
    module: "http",
    message: "http.lifecycle_failure",
    level: "error",
    result: "failed",
  });
}

/** Record an HTTP request failure without exposing the handled exception. */
export function logHttpRequestFailure(): void {
  logTaskDesk({
    module: "http",
    message: "http.request",
    level: "error",
    result: "failed",
  });
}

/** Record a database failure without exposing driver or connection details. */
export function logDatabaseFailure(): void {
  logTaskDesk({
    module: "database",
    message: "database.failure",
    level: "error",
    result: "failed",
  });
}
