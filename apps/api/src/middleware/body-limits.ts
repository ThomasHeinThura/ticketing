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
 * Wraps `source` in a stream that reads nothing by itself: a chunk is pulled from the source only
 * when the consumer asks for one (`highWaterMark: 0`, no read in `start`), counted, and passed on.
 * The chunk that takes the total past `maxBytes` is not passed on; the stream errors with
 * `BodyLimitError` and the source is cancelled.
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
          void reader.cancel().catch(() => undefined);
          controller.error(new BodyLimitError(maxBytes));
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return { body, exceeded: () => exceeded };
}

/**
 * App-wide `/api` body limit (issue #704). It never reads a body itself:
 * - a declared `Content-Length` over the limit is refused at once with `413` (Node's HTTP parser
 *   holds a request to its declared length, so a declared length within the limit passes as is);
 * - a body without a declared length (chunked) is replaced by a counting stream that reads only
 *   as fast as a downstream reader consumes it. A request refused before anything reads its body
 *   (the auth guard's `401`, a host or CSRF refusal) never pulls a byte. Whoever reads past the
 *   limit gets `BodyLimitError` (a body parser may turn that into its own error); either way the
 *   response becomes the rule's `413`.
 * Anything outside `/api` and the two exempt upload streams pass through untouched.
 */
export async function apiBodyLimitMiddleware(c: Context, next: Next) {
  const rule = findRule(c.req.method, c.req.path);
  if (!rule || rule.maxBytes === "exempt") return next();
  const maxBytes = rule.maxBytes;
  const tooLarge = rule.tooLarge ?? payloadTooLarge;
  const raw = c.req.raw;
  if (!raw.body) return next();

  const declared = raw.headers.get("content-length");
  if (declared !== null && !raw.headers.has("transfer-encoding")) {
    const length = Number(declared);
    if (Number.isSafeInteger(length) && length >= 0)
      return length > maxBytes ? tooLarge() : next();
  }

  const limited = countingBody(raw.body, maxBytes);
  c.req.raw = new Request(raw, {
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
