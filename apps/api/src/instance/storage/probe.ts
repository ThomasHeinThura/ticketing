import { randomUUID } from "node:crypto";
import type { StorageProbeAdapter } from "../../storage";
import { StorageProbeCollisionError } from "../../storage/probe-error";

const PROBE_BYTES = Buffer.from("taskdesk-storage-probe-v1-check!", "utf8");
const OPERATION_TIMEOUT_MS = 2_000;

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
  diagnosticObjectMayRemain: boolean;
  durationMs: number;
};

type CallResult<T> =
  | { kind: "completed"; value: T }
  | { kind: "failed"; collision: boolean }
  | { kind: "timed_out" };

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
  const timeout = new Promise<CallResult<T>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error("Storage operation timed out."));
      resolve({ kind: "timed_out" });
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
  // S3 may commit a PUT, lose its response, then return a collision on retry.
  // Only the filesystem's exclusive-create failure proves no object was written.
  const creationExcluded =
    adapter.driver === "filesystem" &&
    write.kind === "failed" &&
    write.collision;
  const diagnosticObjectMayRemain = !creationExcluded;

  if (write.kind === "timed_out") {
    status = "timed_out";
  } else if (write.kind === "failed") {
    status = "write_failed";
  } else {
    const read = await boundedCall(OPERATION_TIMEOUT_MS, (signal) =>
      adapter.read(key, PROBE_BYTES.byteLength, signal),
    );
    if (read.kind === "timed_out") status = "timed_out";
    else if (read.kind === "failed") status = "read_failed";
    else
      status = read.value.equals(PROBE_BYTES) ? "verified" : "content_mismatch";
  }

  return {
    status,
    cleanup: "not_attempted",
    diagnosticObjectMayRemain,
    durationMs: Math.min(15_000, Math.max(0, Math.round(now() - startedAt))),
  };
}
