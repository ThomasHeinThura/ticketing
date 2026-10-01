import type { BrowserContext, Request, Response } from "@playwright/test";

const MAX_REQUESTS = 2_048;
const MAX_ATTACHMENT_BYTES = 256 * 1_024;
const MAX_PATH_LENGTH = 160;

const HTTP_METHODS = new Set([
  "CONNECT",
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

const RESOURCE_TYPES = new Set([
  "document",
  "eventsource",
  "fetch",
  "font",
  "image",
  "manifest",
  "media",
  "other",
  "script",
  "stylesheet",
  "texttrack",
  "websocket",
  "xhr",
]);

const SENSITIVE_SEGMENTS =
  /(?:access[-_]?token|api[-_]?key|authorization|bearer|credential|password|passwd|refresh[-_]?token|secret|session|signature|token)/i;
const IDENTIFIER_PREDECESSORS =
  /^(?:account|accounts|organization|organizations|person|people|project|projects|session|sessions|task|tasks|user|users|work-item|work-items|workspace|workspaces)$/i;
const DYNAMIC_SEGMENTS = [
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i,
  /^[\da-f]{24,}$/i,
  /^\d{12,}$/,
  /^(?=.*[a-z])(?=.*\d)[a-z\d_-]{6,}$/i,
];

type HttpMethod =
  | "CONNECT"
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "OTHER";

type ResourceType =
  | "document"
  | "eventsource"
  | "fetch"
  | "font"
  | "image"
  | "manifest"
  | "media"
  | "other"
  | "script"
  | "stylesheet"
  | "texttrack"
  | "websocket"
  | "xhr";

type RequestTiming = {
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
};

export type PerformanceNetworkRecord = {
  method: HttpMethod;
  path: string;
  resourceType: ResourceType;
  status?: number;
  failed?: true;
  timing?: RequestTiming;
};

type PerformanceNetworkSummary = {
  schemaVersion: 1;
  requests: PerformanceNetworkRecord[];
  droppedCount: number;
  truncated: boolean;
};

type PerformanceNetworkCaptureOptions = {
  maxRequests?: number;
  maxAttachmentBytes?: number;
};

function boundedPositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(fallback, Math.floor(value)));
}

function safePath(urlValue: string, origin: string) {
  try {
    const parsed = new URL(urlValue);
    if (parsed.origin !== new URL(origin).origin) return "external";
    if (parsed.pathname.length > MAX_PATH_LENGTH) return "/:redacted";

    const segments = parsed.pathname.split("/");
    return segments
      .map((segment, index) => {
        if (!segment) return "";
        if (segment.length > 80 || segment.includes("%")) return ":redacted";

        const previousSegment = segments[index - 1] ?? "";
        const isSensitive =
          SENSITIVE_SEGMENTS.test(segment) ||
          SENSITIVE_SEGMENTS.test(previousSegment) ||
          IDENTIFIER_PREDECESSORS.test(previousSegment) ||
          segment.includes("@") ||
          DYNAMIC_SEGMENTS.some((pattern) => pattern.test(segment));
        if (isSensitive || !/^[A-Za-z0-9._~-]+$/.test(segment))
          return ":redacted";
        return segment;
      })
      .join("/");
  } catch {
    return "external";
  }
}

function safeMethod(method: string): HttpMethod {
  const normalized = method.toUpperCase();
  return HTTP_METHODS.has(normalized) ? (normalized as HttpMethod) : "OTHER";
}

function safeResourceType(resourceType: string): ResourceType {
  return RESOURCE_TYPES.has(resourceType)
    ? (resourceType as ResourceType)
    : "other";
}

function finiteStatus(status: number) {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

function finiteTiming(request: Request): RequestTiming | undefined {
  const raw = request.timing();
  const timing: RequestTiming = {};
  for (const key of ["requestStart", "responseStart", "responseEnd"] as const) {
    const value = raw[key];
    if (Number.isFinite(value) && value >= 0) timing[key] = value;
  }
  return Object.keys(timing).length > 0 ? timing : undefined;
}

function encodeWithinByteLimit(
  requests: PerformanceNetworkRecord[],
  droppedCount: number,
  maxBytes: number,
) {
  const encode = (count: number) => {
    const omittedCount = requests.length - count;
    const totalDropped = droppedCount + omittedCount;
    const summary: PerformanceNetworkSummary = {
      schemaVersion: 1,
      requests: requests.slice(0, count),
      droppedCount: totalDropped,
      truncated: totalDropped > 0,
    };
    return JSON.stringify(summary);
  };

  let low = 0;
  let high = requests.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(encode(middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }

  const encoded = encode(low);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes)
    throw new Error(
      "The performance network summary header exceeds its byte cap.",
    );
  return encoded;
}

export function attachPerformanceNetworkCapture(
  context: BrowserContext,
  origin: string,
  options: PerformanceNetworkCaptureOptions = {},
) {
  const maxRequests = boundedPositiveInteger(options.maxRequests, MAX_REQUESTS);
  const maxAttachmentBytes = boundedPositiveInteger(
    options.maxAttachmentBytes,
    MAX_ATTACHMENT_BYTES,
  );
  const requests: PerformanceNetworkRecord[] = [];
  const inFlight = new Map<Request, PerformanceNetworkRecord>();
  let droppedCount = 0;

  const onRequest = (request: Request) => {
    if (requests.length >= maxRequests) {
      droppedCount += 1;
      return;
    }

    const record: PerformanceNetworkRecord = {
      method: safeMethod(request.method()),
      path: safePath(request.url(), origin),
      resourceType: safeResourceType(request.resourceType()),
    };
    requests.push(record);
    inFlight.set(request, record);
  };

  const onResponse = (response: Response) => {
    const record = inFlight.get(response.request());
    if (!record) return;
    const status = finiteStatus(response.status());
    if (status !== undefined) record.status = status;
  };

  const onRequestFinished = (request: Request) => {
    const record = inFlight.get(request);
    if (!record) return;
    record.timing = finiteTiming(request);
    inFlight.delete(request);
  };

  const onRequestFailed = (request: Request) => {
    const record = inFlight.get(request);
    if (!record) return;
    record.failed = true;
    inFlight.delete(request);
  };

  context.on("request", onRequest);
  context.on("response", onResponse);
  context.on("requestfinished", onRequestFinished);
  context.on("requestfailed", onRequestFailed);

  return {
    finish() {
      context.off("request", onRequest);
      context.off("response", onResponse);
      context.off("requestfinished", onRequestFinished);
      context.off("requestfailed", onRequestFailed);
      inFlight.clear();
      return encodeWithinByteLimit(requests, droppedCount, maxAttachmentBytes);
    },
  };
}
