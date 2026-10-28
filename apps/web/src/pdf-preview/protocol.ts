export const PDF_PREVIEW_PROTOCOL = "taskdesk.pdf-preview.v1" as const;

export const PDF_PREVIEW_LIMITS = {
  bytes: 25 * 1024 * 1024,
  pages: 200,
  pixelsPerPage: 16_000_000,
  scaleMin: 0.75,
  scaleMax: 2,
  loadMs: 20_000,
  renderMs: 15_000,
} as const;

export type PdfPreviewReadyMessage = {
  protocol: typeof PDF_PREVIEW_PROTOCOL;
  type: "ready";
};

export type PdfPreviewPortMessage = {
  protocol: typeof PDF_PREVIEW_PROTOCOL;
  nonce: string;
  type: "connected" | "disposed" | "loaded" | "rendered" | "failed";
  pageCount?: number;
  pageNumber?: number;
  scale?: number;
  reason?: "unavailable" | "resource_limit" | "timeout";
};

export function isPdfPreviewReadyMessage(
  value: unknown,
): value is PdfPreviewReadyMessage {
  return (
    isRecord(value) &&
    value.protocol === PDF_PREVIEW_PROTOCOL &&
    value.type === "ready"
  );
}

export function isPdfPreviewNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(value);
}

export function isPdfPreviewPortMessage(
  value: unknown,
  nonce: string,
): value is PdfPreviewPortMessage {
  if (
    !isRecord(value) ||
    value.protocol !== PDF_PREVIEW_PROTOCOL ||
    value.nonce !== nonce
  )
    return false;
  if (value.type === "connected" || value.type === "disposed") return true;
  if (value.type === "loaded")
    return (
      Number.isSafeInteger(value.pageCount) &&
      Number(value.pageCount) >= 1 &&
      Number(value.pageCount) <= PDF_PREVIEW_LIMITS.pages
    );
  if (value.type === "rendered")
    return (
      Number.isSafeInteger(value.pageNumber) &&
      Number(value.pageNumber) >= 1 &&
      Number(value.pageNumber) <= PDF_PREVIEW_LIMITS.pages &&
      typeof value.scale === "number" &&
      Number.isFinite(value.scale) &&
      value.scale >= PDF_PREVIEW_LIMITS.scaleMin &&
      value.scale <= PDF_PREVIEW_LIMITS.scaleMax
    );
  return (
    value.type === "failed" &&
    (value.reason === "unavailable" ||
      value.reason === "resource_limit" ||
      value.reason === "timeout")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
