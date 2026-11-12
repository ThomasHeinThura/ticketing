import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import type { PortalCase } from "@/fetchers/portal/cases";
import {
  HttpError,
  httpErrorFromResponse,
  readErrorDetail,
} from "@/lib/http-error";

/**
 * A request the team raised for the customer (`direct`, D6), as `GET /api/portal/requests/{ref}`
 * returns it (U-12). The case row plus the public conversation; never an assignee, an internal
 * comment or an internal field (CP-3, CP-4).
 */
export type PortalRequestMessage = {
  id: string;
  actorType: "customer" | "triager" | "system";
  authorName: string | null;
  mine: boolean;
  body: string;
  createdAt: string;
};

export type PortalRequestDetail = PortalCase & {
  description: string;
  resolvedAt: string | null;
  customFields: Array<{
    key: string;
    label: string;
    format: string;
    helpText: string | null;
    value: unknown;
  }>;
  /** CP-16: the requester replies; a colleague or participant only reads. */
  canReply: boolean;
  /** CP-16: files are the requester's only. */
  canViewAttachments: boolean;
  canUpload: boolean;
  messages: PortalRequestMessage[];
};

export type PortalRequestFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  state: string;
  /** The viewer uploaded it; otherwise the team shared it. */
  mine: boolean;
  /** The portal can serve its bytes (CP-19 portal-bound link); false while still uploading. */
  downloadable: boolean;
  createdAt: string;
};

function requestPath(ref: string, suffix = "") {
  return `/portal/requests/${encodeURIComponent(ref)}${suffix}`;
}

async function send<T>(
  path: string,
  fallback: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
    method: init.method ?? "GET",
    ...(init.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
  if (response.status >= 500)
    throw await httpErrorFromResponse(response, "The request failed");
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, fallback),
    );
  return response.json() as Promise<T>;
}

export function getPortalRequest(ref: string) {
  return send<PortalRequestDetail>(
    requestPath(ref),
    "Failed to load the request",
  );
}

export function replyToPortalRequest(input: { ref: string; body: string }) {
  return send<{ ref: string; message: PortalRequestMessage }>(
    requestPath(input.ref, "/comments"),
    "Could not send the reply",
    { method: "POST", body: { body: input.body } },
  );
}

export function getPortalRequestFiles(ref: string) {
  return send<PortalRequestFile[]>(
    requestPath(ref, "/attachments"),
    "Could not load files",
  );
}

/**
 * A-08: one file on the requester's reply. Presign on the API, put the bytes straight to storage
 * (the API never proxies them), then complete, where size and content are checked.
 */
export async function uploadPortalRequestFile(input: {
  ref: string;
  commentId: string;
  file: File;
}) {
  const signed = await send<{
    attachmentId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  }>(requestPath(input.ref, "/attachments/presign"), "Could not upload", {
    method: "POST",
    body: {
      filename: input.file.name,
      contentType: input.file.type || "application/octet-stream",
      size: input.file.size,
      commentId: input.commentId,
    },
  });
  const put = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: signed.uploadHeaders,
    body: input.file,
  });
  if (!put.ok) throw new HttpError(put.status, "");
  return send<PortalRequestFile>(
    requestPath(
      input.ref,
      `/attachments/${encodeURIComponent(signed.attachmentId)}/complete`,
    ),
    "Could not finish the upload",
    { method: "POST" },
  );
}

/** The API's short-lived download redirect (AT-5); the browser follows it. */
export function portalRequestFileUrl(ref: string, id: string) {
  return getApiUrl(requestPath(ref, `/attachments/${encodeURIComponent(id)}`));
}
