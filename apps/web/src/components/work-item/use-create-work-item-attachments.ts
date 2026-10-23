import { useLayoutEffect, useRef, useState } from "react";
import {
  type AttachmentUploadCheckpoint,
  resumeWorkItemAttachment,
} from "@/fetchers/attachment/work-item-attachments";

export type StagedWorkItemAttachment = {
  id: number;
  file: File;
  preview?: string;
  state: "staged" | "uploading" | "ready" | "failed";
  checkpoint?: AttachmentUploadCheckpoint;
  error?: unknown;
};

function release(row: StagedWorkItemAttachment) {
  if (row.preview) URL.revokeObjectURL(row.preview);
}

/** Local files only until an explicit create has returned its persisted key. */
export function useCreateWorkItemAttachments(scope: string) {
  const [rows, setRows] = useState<StagedWorkItemAttachment[]>([]);
  const current = useRef(rows);
  const nextId = useRef(0);
  const generation = useRef(0);
  const running = useRef(false);
  const previousScope = useRef(scope);
  function publish(value: StagedWorkItemAttachment[]) {
    current.current = value;
    setRows(value);
  }
  function reset() {
    generation.current += 1;
    running.current = false;
    current.current.forEach(release);
    publish([]);
  }
  useLayoutEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      reset();
    }
  });
  useLayoutEffect(
    () => () => {
      generation.current += 1;
      current.current.forEach(release);
      current.current = [];
    },
    [],
  );
  function stage(files: File[]) {
    if (running.current) return;
    publish([
      ...current.current,
      ...files.map((file) => ({
        id: nextId.current++,
        file,
        preview:
          /^(image\/(png|jpeg|gif|webp))$/.test(file.type) &&
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : undefined,
        state: "staged" as const,
      })),
    ]);
  }
  function remove(id: number) {
    if (running.current) return;
    const row = current.current.find((entry) => entry.id === id);
    // A file that failed to upload can be dropped; one that is uploading or attached cannot.
    if (row?.state !== "staged" && row?.state !== "failed") return;
    release(row);
    publish(current.current.filter((entry) => entry.id !== id));
  }
  async function upload(key: string) {
    if (running.current) return false;
    running.current = true;
    const intent = generation.current;
    const active = () => intent === generation.current;
    function patch(id: number, value: Partial<StagedWorkItemAttachment>) {
      if (active())
        publish(
          current.current.map((row) =>
            row.id === id ? { ...row, ...value } : row,
          ),
        );
    }
    try {
      for (const row of current.current) {
        if (!active()) return false;
        if (row.state === "ready") continue;
        patch(row.id, { state: "uploading", error: undefined });
        try {
          if (row.file.size === 0) throw new Error("empty");
          await resumeWorkItemAttachment(
            key,
            row.file,
            row.checkpoint,
            (checkpoint) => patch(row.id, { checkpoint }),
          );
          patch(row.id, { state: "ready" });
        } catch (error) {
          patch(row.id, { state: "failed", error });
        }
      }
      return active() && current.current.every((row) => row.state === "ready");
    } finally {
      if (active()) running.current = false;
    }
  }
  return { rows, stage, remove, reset, upload };
}
