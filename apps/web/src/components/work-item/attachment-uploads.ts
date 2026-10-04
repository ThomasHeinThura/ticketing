import {
  completeWorkItemAttachment,
  presignWorkItemAttachment,
} from "@/fetchers/work-item/attachments";

export type AttachmentUploadState = {
  id: string;
  workItemKey: string;
  filename: string;
  size: number;
  progress: number;
  status: "preparing" | "uploading" | "validating" | "complete" | "failed";
  error?: string;
  cancellation?: "user" | "leaving-app";
};

type UploadListener = () => void;
const uploads = new Map<string, AttachmentUploadState>();
const listeners = new Set<UploadListener>();
const controllers = new Map<string, AbortController>();
const filesByUploadId = new Map<string, File>();
const uploadById = new Map<string, (file: File) => void>();
const snapshots = new Map<string, AttachmentUploadState[]>();
const onCompleteById = new Map<string, () => void>();
const EMPTY_UPLOADS: AttachmentUploadState[] = [];
let unloadHandlersInstalled = false;

function notify(workItemKey: string) {
  snapshots.set(
    workItemKey,
    [...uploads.values()].filter(
      (upload) => upload.workItemKey === workItemKey,
    ),
  );
  for (const listener of listeners) listener();
}

function update(id: string, patch: Partial<AttachmentUploadState>) {
  const current = uploads.get(id);
  if (!current) return;
  uploads.set(id, { ...current, ...patch });
  notify(current.workItemKey);
}

function installUnloadHandlers() {
  if (unloadHandlersInstalled || typeof window === "undefined") return;
  unloadHandlersInstalled = true;
  window.addEventListener("beforeunload", warnBeforeLeaving);
  window.addEventListener("pagehide", abortOnPageHide);
}

function removeUnloadHandlersIfIdle() {
  if (!unloadHandlersInstalled || controllers.size > 0) return;
  unloadHandlersInstalled = false;
  window.removeEventListener("beforeunload", warnBeforeLeaving);
  window.removeEventListener("pagehide", abortOnPageHide);
}

function warnBeforeLeaving(event: BeforeUnloadEvent) {
  if (controllers.size === 0) return;
  event.preventDefault();
  event.returnValue = "";
}

function abortOnPageHide() {
  for (const [id, controller] of controllers) {
    uploads.set(id, {
      ...(uploads.get(id) as AttachmentUploadState),
      cancellation: "leaving-app",
    });
    controller.abort("leaving-app");
  }
  for (const workItemKey of new Set(
    [...uploads.values()].map((upload) => upload.workItemKey),
  )) {
    notify(workItemKey);
  }
}

function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.withCredentials = false;
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(
          Math.min(99, Math.round((event.loaded / event.total) * 100)),
        );
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else
        reject(
          new Error(`Storage rejected the file (HTTP ${request.status}).`),
        );
    };
    request.onerror = () =>
      reject(new Error("Storage could not receive this file."));
    request.onabort = () =>
      reject(new DOMException("Upload cancelled.", "AbortError"));
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export function subscribeAttachmentUploads(listener: UploadListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAttachmentUploadsSnapshot() {
  return [...uploads.values()];
}

export function getWorkItemAttachmentUploadsSnapshot(workItemKey: string) {
  return snapshots.get(workItemKey) ?? EMPTY_UPLOADS;
}

export function cancelAttachmentUpload(id: string) {
  const upload = uploads.get(id);
  if (upload) update(id, { cancellation: "user" });
  controllers.get(id)?.abort("user");
}

export function enqueueAttachmentUploads(
  workItemKey: string,
  files: File[],
  onComplete?: () => void,
) {
  const ids: string[] = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    ids.push(id);
    const sourceFile = file;
    filesByIdSet(sourceFile, id);
    if (onComplete) onCompleteById.set(id, onComplete);
    uploads.set(id, {
      id,
      workItemKey,
      filename: file.name || "file",
      size: file.size,
      progress: 0,
      status: "preparing",
    });
    installUnloadHandlers();
    notify(workItemKey);
    const run = (retryFile: File) => {
      const retryController = new AbortController();
      controllers.set(id, retryController);
      update(id, {
        status: "preparing",
        progress: 0,
        error: undefined,
        cancellation: undefined,
      });
      void (async () => {
        try {
          const presigned = await presignWorkItemAttachment({
            key: workItemKey,
            filename: retryFile.name || "file",
            contentType: retryFile.type || "application/octet-stream",
            size: retryFile.size,
          });
          if (retryController.signal.aborted)
            throw new DOMException("Upload cancelled.", "AbortError");
          update(id, { status: "uploading" });
          await putWithProgress(
            presigned.uploadUrl,
            presigned.uploadHeaders,
            retryFile,
            retryController.signal,
            (progress) => update(id, { progress }),
          );
          if (retryController.signal.aborted)
            throw new DOMException("Upload cancelled.", "AbortError");
          update(id, { status: "validating", progress: 100 });
          await completeWorkItemAttachment(presigned.attachmentId);
          update(id, {
            status: "complete",
            progress: 100,
            error: undefined,
            cancellation: undefined,
          });
          try {
            onCompleteById.get(id)?.();
          } catch {
            // Upload success is already committed by the server. Cache refresh is best effort.
          }
          filesByUploadId.delete(id);
          uploadById.delete(id);
          onCompleteById.delete(id);
          window.setTimeout(() => {
            const completed = uploads.get(id);
            if (completed?.status !== "complete") return;
            uploads.delete(id);
            notify(workItemKey);
          }, 5_000);
        } catch (error) {
          if (retryController.signal.aborted) {
            const cancellation =
              retryController.signal.reason === "leaving-app"
                ? "leaving-app"
                : "user";
            update(id, { status: "failed", cancellation, error: undefined });
          } else {
            update(id, {
              status: "failed",
              cancellation: undefined,
              error: error instanceof Error ? error.message : "Upload failed.",
            });
          }
        } finally {
          controllers.delete(id);
          removeUnloadHandlersIfIdle();
        }
      })();
    };
    uploadById.set(id, run);
    run(file);
  }
  return ids;
}

function filesByIdSet(file: File, id: string) {
  filesByUploadId.set(id, file);
}

export function retryAttachmentUpload(id: string) {
  const file = filesByUploadId.get(id);
  const retry = uploadById.get(id);
  const upload = uploads.get(id);
  if (file && retry && upload?.status === "failed") retry(file);
}
