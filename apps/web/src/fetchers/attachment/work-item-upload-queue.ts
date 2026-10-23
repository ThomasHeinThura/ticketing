import { HttpError } from "@/lib/http-error";
import {
  type AttachmentUploadCheckpoint,
  resumeWorkItemAttachment,
} from "./work-item-attachments";

/**
 * AT-12/AT-13: uploads live in a module-level queue, not in a component, so they continue
 * while the user navigates inside the app and every file reports its own progress and its
 * own failure. Leaving the app (reload, tab close) interrupts them, so a `beforeunload`
 * warning is registered for exactly as long as one is queued or in flight.
 */
export type WorkItemUpload = {
  id: number;
  itemKey: string;
  /** AT-1: set when the file belongs to a comment instead of the work item. */
  commentId?: string;
  file: File;
  state: "queued" | "uploading" | "failed";
  loaded: number;
  /** A server rejection that says exactly why (AT-14), or undefined for a generic failure. */
  reason?: string;
  empty?: boolean;
  checkpoint?: AttachmentUploadCheckpoint;
};

type Entry = WorkItemUpload & { onDone?: (upload: WorkItemUpload) => void };

const MAX_PARALLEL = 3;
let nextId = 1;
let entries: Entry[] = [];
let snapshot: readonly WorkItemUpload[] = [];
const listeners = new Set<() => void>();
let unloadArmed = false;

function warnOnLeave(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Legacy browsers read returnValue; modern ones show their own generic warning.
  event.returnValue = "";
}

function publish() {
  snapshot = entries.map(({ onDone: _onDone, ...upload }) => upload);
  const active = entries.some((entry) => entry.state !== "failed");
  if (typeof window !== "undefined" && active !== unloadArmed) {
    unloadArmed = active;
    if (active) window.addEventListener("beforeunload", warnOnLeave);
    else window.removeEventListener("beforeunload", warnOnLeave);
  }
  for (const listener of listeners) listener();
}

function patch(id: number, value: Partial<Entry>) {
  entries = entries.map((entry) =>
    entry.id === id ? { ...entry, ...value } : entry,
  );
  publish();
}

function pump() {
  const running = entries.filter((entry) => entry.state === "uploading").length;
  const queued = entries.filter((entry) => entry.state === "queued");
  for (const entry of queued.slice(0, Math.max(0, MAX_PARALLEL - running)))
    void run(entry.id);
}

async function run(id: number) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry?.state !== "queued") return;
  patch(id, { state: "uploading", loaded: 0, reason: undefined });
  try {
    if (entry.file.size === 0)
      throw Object.assign(new Error("empty"), { empty: true });
    await resumeWorkItemAttachment(
      entry.itemKey,
      entry.file,
      entry.checkpoint,
      (checkpoint) => patch(id, { checkpoint }),
      {
        commentId: entry.commentId,
        onProgress: (loaded) => patch(id, { loaded }),
      },
    );
    const finished = entries.find((candidate) => candidate.id === id);
    entries = entries.filter((candidate) => candidate.id !== id);
    publish();
    finished?.onDone?.(finished);
  } catch (error) {
    patch(id, {
      state: "failed",
      empty: (error as { empty?: boolean }).empty === true,
      reason:
        error instanceof HttpError && error.status < 500 && error.message
          ? error.message
          : undefined,
    });
    // A failed file is still a settled outcome for whoever is waiting on this batch.
    const failed = entries.find((candidate) => candidate.id === id);
    if (failed) failed.onDone?.(failed);
  } finally {
    pump();
  }
}

/** Queue files for a work item (or one of its comments). Returns the queued upload ids. */
export function enqueueWorkItemUploads(input: {
  itemKey: string;
  commentId?: string;
  files: File[];
  /** Called once per file when it settles: ready (the row is gone) or failed (the row stays). */
  onDone?: (upload: WorkItemUpload) => void;
}) {
  const created: Entry[] = input.files.map((file) => ({
    id: nextId++,
    itemKey: input.itemKey,
    commentId: input.commentId,
    file,
    state: "queued",
    loaded: 0,
    onDone: input.onDone,
  }));
  entries = [...entries, ...created];
  publish();
  pump();
  return created.map((entry) => entry.id);
}

/** Retry a failed file against the same attachment ID (the checkpoint is kept). */
export function retryWorkItemUpload(id: number) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry?.state !== "failed") return;
  patch(id, { state: "queued", loaded: 0, reason: undefined, empty: false });
  pump();
}

/** Drop a failed file from the list. A file that is queued or uploading cannot be dropped. */
export function dismissWorkItemUpload(id: number) {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry?.state !== "failed") return;
  entries = entries.filter((candidate) => candidate.id !== id);
  publish();
}

export function subscribeWorkItemUploads(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWorkItemUploads(): readonly WorkItemUpload[] {
  return snapshot;
}

/** Test seam: forget every upload and disarm the unload warning. */
export function resetWorkItemUploads() {
  entries = [];
  publish();
}
