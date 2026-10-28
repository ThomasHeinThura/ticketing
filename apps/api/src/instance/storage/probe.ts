import { randomUUID } from "node:crypto";
import type { StorageProbeAdapter } from "../../storage";
import { StorageProbeCollisionError } from "../../storage/probe-error";

const PROBE_BYTES = Buffer.from("taskdesk-storage-probe-v1-check!", "utf8");
const OPERATION_TIMEOUT_MS = 2_000;
const CLEANUP_TIMEOUT_MS = 2_000;

export type StorageProbeResult = {
  status:
    | "verified"
    | "write_failed"
    | "read_failed"
    | "content_mismatch"
    | "timed_out"
    | "cleanup_failed"
    | "cleanup_indeterminate";
  cleanup: "confirmed" | "failed" | "indeterminate" | "not_attempted";
  durationMs: number;
};

type CallResult<T> =
  | { kind: "completed"; value: T }
  | { kind: "failed"; collision: boolean }
  | {
      kind: "timed_out";
      settled: Promise<"completed" | "failed" | "collision">;
    };

async function boundedCall<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  isCollision: (error: unknown) => boolean = () => false,
): Promise<CallResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = Promise.resolve()
    .then(() => run(controller.signal))
    .then(
      (value): CallResult<T> => ({ kind: "completed", value }),
      (error): CallResult<T> => ({
        kind: "failed",
        collision: isCollision(error),
      }),
    );
  const settled: Promise<"completed" | "failed" | "collision"> = operation.then(
    (result) => {
      if (result.kind === "completed") return "completed";
      if (result.kind === "failed" && result.collision) return "collision";
      return "failed";
    },
  );
  const timeout = new Promise<CallResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("Storage operation timed out."));
      resolve({ kind: "timed_out", settled });
    }, timeoutMs);
  });
  const result = await Promise.race([operation, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

/** Uses only a generated reserved key and fixed nonsecret bytes. */
export async function runStorageProbe(
  adapter: StorageProbeAdapter,
  options: { now?: () => number; createId?: () => string } = {},
): Promise<StorageProbeResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const id = options.createId?.() ?? randomUUID();
  if (!/^[0-9a-f-]{36}$/u.test(id))
    throw new Error("Storage probe identifier generation failed.");
  const key = `taskdesk-storage-probe-${id}`;

  const write = await boundedCall(
    OPERATION_TIMEOUT_MS,
    (signal) => adapter.write(key, PROBE_BYTES, signal),
    (error) => error instanceof StorageProbeCollisionError,
  );
  let status: StorageProbeResult["status"];
  let cleanup: StorageProbeResult["cleanup"] = "not_attempted";

  if (write.kind === "timed_out") {
    status = "timed_out";
    // If the write eventually confirms creation, retry exact-key cleanup. If it failed (for
    // example, an exclusive-create collision), never delete an object this probe did not own.
    void write.settled
      .then((outcome) => {
        if (outcome === "collision") return undefined;
        return boundedCall(CLEANUP_TIMEOUT_MS, (signal) =>
          adapter.delete(key, signal),
        );
      })
      .catch(() => {});
    cleanup = "indeterminate";
  } else if (write.kind === "failed") {
    if (write.collision) {
      status = "write_failed";
    } else {
      status = "cleanup_indeterminate";
      cleanup = "indeterminate";
    }
  } else {
    const read = await boundedCall(OPERATION_TIMEOUT_MS, (signal) =>
      adapter.read(key, PROBE_BYTES.byteLength, signal),
    );
    if (read.kind === "timed_out") status = "timed_out";
    else if (read.kind === "failed") status = "read_failed";
    else
      status = read.value.equals(PROBE_BYTES) ? "verified" : "content_mismatch";

    const deleted = await boundedCall(CLEANUP_TIMEOUT_MS, (signal) =>
      adapter.delete(key, signal),
    );
    cleanup =
      deleted.kind === "completed"
        ? "confirmed"
        : deleted.kind === "failed"
          ? "failed"
          : "indeterminate";
  }

  if (cleanup === "indeterminate") status = "cleanup_indeterminate";
  else if (cleanup === "failed") status = "cleanup_failed";
  if (status === "verified" && cleanup !== "confirmed")
    status = cleanup === "failed" ? "cleanup_failed" : "cleanup_indeterminate";

  return {
    status,
    cleanup,
    durationMs: Math.min(15_000, Math.max(0, Math.round(now() - startedAt))),
  };
}
