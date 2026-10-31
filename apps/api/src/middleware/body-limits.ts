import { Readable } from "node:stream";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { IMPORT_SOURCE_BODY_LIMIT_BYTES } from "../imports/engine/body-limit";

/**
 * Request-body size limits for everything under `/api` (issue #704). The whole API reads JSON
 * bodies into memory, and `/api/auth/*` does so anonymously through Better Auth, so without a cap
 * one request can make the server buffer an unbounded body.
 *
 * One table, used by two layers:
 * - `apiBodyLimitMiddleware`, the app-wide check registered in `createApp()`;
 * - `idempotencyBodyLimit`, which caps the body the idempotency middleware hashes on routes that
 *   take more than the default (it must not hash a body larger than the route accepts).
 *
 * A route's own tighter `bodyLimit` (settings, SCIM, home realm, CSP reports, search) still
 * applies after this one.
 */

const KIB = 1024;
const MIB = 1024 * KIB;

/** Default for every `/api` request not matched below. */
export const API_DEFAULT_BODY_LIMIT_BYTES = 10 * MIB;
/** Better Auth endpoints (`/api/auth/*`): small JSON or form bodies, mostly anonymous. */
export const AUTH_BODY_LIMIT_BYTES = 64 * KIB;

/** Plain-text `413`, the same shape as every other API error (feature-contracts-p4.md `ST-16`). */
const PAYLOAD_TOO_LARGE_MESSAGE = "Payload too large";

type BodyLimitRule = {
  readonly method?: string;
  readonly matches: (path: string) => boolean;
  readonly maxBytes: number | "exempt";
  /** Overrides the default plain-text `413`, so a route keeps its documented error body. */
  readonly tooLarge?: () => Response;
};

/** Hono routes strictly, so a trailing-slash variant reaches no route and gets the default. */
const exactPath = (expected: string) => (path: string) => path === expected;

/**
 * First match wins. Exemptions are exact method + exact path, never a prefix.
 */
const BODY_LIMIT_RULES: readonly BodyLimitRule[] = [
  // Raw upload streams: the handler streams to disk and enforces the admin-set
  // `attachmentMaxBytes` itself; buffering them here would defeat that.
  {
    method: "PUT",
    matches: exactPath("/api/storage/filesystem-upload"),
    maxBytes: "exempt",
  },
  {
    method: "PUT",
    matches: exactPath("/api/storage/filesystem-attachment-upload"),
    maxBytes: "exempt",
  },
  {
    method: "POST",
    matches: exactPath("/api/import-sources"),
    maxBytes: IMPORT_SOURCE_BODY_LIMIT_BYTES,
    // The route's own limiter answers this JSON body (imports/engine/routes.ts); this layer runs
    // first, so it answers identically.
    tooLarge: () =>
      Response.json({ message: "Request body too large" }, { status: 413 }),
  },
  {
    matches: (path) => path === "/api/auth" || path.startsWith("/api/auth/"),
    maxBytes: AUTH_BODY_LIMIT_BYTES,
  },
  {
    matches: (path) => path === "/api" || path.startsWith("/api/"),
    maxBytes: API_DEFAULT_BODY_LIMIT_BYTES,
  },
];

function findRule(method: string, path: string): BodyLimitRule | undefined {
  const upper = method.toUpperCase();
  return BODY_LIMIT_RULES.find(
    (rule) =>
      (rule.method === undefined || rule.method === upper) &&
      rule.matches(path),
  );
}

/**
 * The body limit for a request: a byte count, `"exempt"` for the raw upload streams, or
 * `undefined` for a path outside `/api` (SCIM and static serving have their own handling).
 */
export function apiBodyLimitFor(
  method: string,
  path: string,
): number | "exempt" | undefined {
  return findRule(method, path)?.maxBytes;
}

/**
 * Routes that accept more than `API_DEFAULT_BODY_LIMIT_BYTES`, with the most the route accepts.
 * The idempotency middleware hashes the whole body, so it caps the body itself on these routes.
 * Every other route returns `undefined` (no cap in that layer; the app-wide check applies).
 */
export function idempotencyBodyLimit(
  method: string,
  pathname: string,
): number | undefined {
  const limit = apiBodyLimitFor(method, pathname);
  return typeof limit === "number" && limit > API_DEFAULT_BODY_LIMIT_BYTES
    ? limit
    : undefined;
}

/** The plain-text `413` an `HTTPException` produces (feature-contracts-p4.md `ST-16`). */
const payloadTooLarge = () =>
  new HTTPException(413, { message: PAYLOAD_TOO_LARGE_MESSAGE }).getResponse();

/** The error a capped request body raises in whoever reads past the limit. */
export class BodyLimitError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "BodyLimitError";
  }
}

/**
 * A web stream over a Node request body that reads nothing by itself: each `pull` (only when a
 * consumer asks, `highWaterMark: 0`) takes one chunk with `incoming.read()`, waiting for
 * `readable`/`end`/`error` when nothing is buffered. Until the first pull, no byte leaves the
 * `IncomingMessage` (`readableDidRead` stays false), so `@hono/node-server` can still drain or
 * close an unread body after the response.
 */
export function incomingBody(incoming: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        return new Promise<void>((resolve) => {
          const cleanup = () => {
            incoming.off("readable", tryRead);
            incoming.off("end", onEnd);
            incoming.off("error", onError);
          };
          const onEnd = () => {
            cleanup();
            controller.close();
            resolve();
          };
          const onError = (error: unknown) => {
            cleanup();
            controller.error(error);
            resolve();
          };
          function tryRead() {
            const chunk: unknown = incoming.read();
            if (chunk === null) return false;
            cleanup();
            controller.enqueue(
              typeof chunk === "string"
                ? new TextEncoder().encode(chunk)
                : new Uint8Array(chunk as Uint8Array),
            );
            resolve();
            return true;
          }
          if (incoming.errored) return onError(incoming.errored);
          if (incoming.readableEnded) return onEnd();
          if (tryRead()) return;
          incoming.on("readable", tryRead);
          incoming.once("end", onEnd);
          incoming.once("error", onError);
        });
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * Wraps `source` in a stream that reads nothing by itself: a chunk is pulled from the source only
 * when the consumer asks for one (`highWaterMark: 0`, no read in `start`), counted, and passed on.
 * The chunk that takes the total past `maxBytes` is not passed on and the stream errors with
 * `BodyLimitError`. The source is left as it is (not cancelled): cancelling a body stream that
 * undici is still filling (a `FormData` body) raises an unhandled "already closed" error, and an
 * unread Node request body is drained or closed by `@hono/node-server` after the response.
 */
export function countingBody(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
): { body: ReadableStream<Uint8Array>; exceeded: () => boolean } {
  const reader = source.getReader();
  let received = 0;
  let exceeded = false;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          exceeded = true;
          reader.releaseLock();
          controller.error(new BodyLimitError(maxBytes));
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason).catch(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );
  return { body, exceeded: () => exceeded };
}

/** The Node request behind `@hono/node-server`, when it is still unread. */
function unreadIncoming(c: Context): Readable | undefined {
  const incoming = (c.env as { incoming?: unknown } | undefined)?.incoming;
  if (!(incoming instanceof Readable)) return undefined;
  if (incoming.readableDidRead || "rawBody" in incoming) return undefined;
  return incoming;
}

/**
 * App-wide `/api` body limit (issue #704). It never reads a body itself, and decides from the
 * method and headers alone (`c.req.raw.body` is not touched: on `@hono/node-server` that would
 * start reading the socket):
 * - `GET`/`HEAD` pass through;
 * - a declared `Content-Length` (without `Transfer-Encoding`) over the limit is refused at once
 *   with `413`; within the limit it passes untouched (Node's HTTP parser holds a request to its
 *   declared length, and node-server keeps its direct-read fast path);
 * - otherwise (chunked or unknown length) the body is replaced by a counting stream that reads
 *   from the Node request only as fast as a downstream reader consumes it. A request refused
 *   before anything reads its body (the auth guard's `401`, a host or CSRF refusal) never reads a
 *   byte. Whoever reads past the limit gets `BodyLimitError` (a body parser may turn that into its
 *   own error); either way the response becomes the rule's `413`.
 * Without a Node request (in-process `app.request`, other runtimes) the counting stream wraps
 * `c.req.raw.body` instead. Anything outside `/api` and the two exempt upload streams pass
 * through untouched.
 */
export async function apiBodyLimitMiddleware(c: Context, next: Next) {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return next();
  const rule = findRule(method, c.req.path);
  if (!rule || rule.maxBytes === "exempt") return next();
  const maxBytes = rule.maxBytes;
  const tooLarge = rule.tooLarge ?? payloadTooLarge;

  const declared = c.req.header("content-length");
  if (
    declared !== undefined &&
    c.req.header("transfer-encoding") === undefined
  ) {
    const length = Number(declared);
    if (/^\d+$/.test(declared.trim()) && Number.isSafeInteger(length))
      return length > maxBytes ? tooLarge() : next();
  }

  const raw = c.req.raw;
  const incoming = unreadIncoming(c);
  let source: ReadableStream<Uint8Array>;
  if (incoming) source = incomingBody(incoming);
  else {
    if (!raw.body) return next();
    source = raw.body;
  }
  const limited = countingBody(source, maxBytes);
  c.req.raw = new Request(raw.url, {
    method: raw.method,
    headers: raw.headers,
    signal: raw.signal,
    body: limited.body,
    duplex: "half",
  } as RequestInit);
  // Headers outer middleware (CORS) already put on the response, kept on a replacing 413.
  const earlierHeaders = new Headers(c.res.headers);
  try {
    await next();
  } catch (error) {
    if (!limited.exceeded()) throw error;
  }
  if (!limited.exceeded()) return;
  const response = tooLarge();
  for (const [name, value] of earlierHeaders) {
    if (name === "content-type" || name === "content-length") continue;
    if (name === "set-cookie") response.headers.append(name, value);
    else if (!response.headers.has(name)) response.headers.set(name, value);
  }
  // Drop the downstream response first: assigning over it would merge its headers
  // (Content-Length, Set-Cookie, ...) into the 413.
  c.res = undefined as unknown as Response;
  c.res = response;
}
