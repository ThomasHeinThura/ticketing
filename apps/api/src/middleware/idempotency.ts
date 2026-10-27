import { createHash, randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { IMPORT_SOURCE_BODY_LIMIT_BYTES } from "../imports/engine/body-limit";

/**
 * `Idempotency-Key` handling for unsafe requests (api-design.md "Idempotency";
 * safety-and-runtime.md PA-4 "The retry rule, stated once").
 *
 * The middleware runs **before** the pending-action layer: a keyed retry of a `DELETE`
 * that already produced its `202` replays the stored response and reaches nothing further,
 * so it creates no second pending action. An unkeyed repeat still reaches the
 * pending-action layer and gets `409 pending_approval`.
 *
 * - Same actor + same key + same request (method, path, query, body) → the stored response,
 *   marked `Idempotent-Replayed: true`.
 * - Same actor + same key + a different request → `422 idempotency_key_reused`
 *   (draft-ietf-httpapi-idempotency-key-header: a reused key with a different payload is 422).
 * - Same actor + same key while the first request is still running → `409
 *   idempotency_key_in_flight`.
 * - Every `2xx` JSON response is stored, except secret-bearing routes (see `isSecretBearingRoute`). Any other outcome releases the key, so a retry
 *   runs again (and meets, for example, `409 pending_approval`).
 * - Keys are scoped per actor (API key id for key requests, user id otherwise), so one
 *   caller can never replay another caller's response. Stored responses live 24 hours; an
 *   in-flight reservation is a short lease, taken over if its request died.
 * - A request without the header is passed through unchanged; a malformed header is `400`.
 */
/** Routes whose 2xx bodies carry one-time secrets and must never be persisted or replayed. */
const SECRET_BEARING_ROUTES: readonly RegExp[] = [
  /^\/api\/me\/step-up(\/|$)/,
  /\/scim\/(rotate|revoke)-token$/,
  /\/metrics-token\/rotate$/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/me\/(api-keys?|mfa|totp|backup)/,
  /^\/api\/workspaces\/[^/]+\/api-keys/,
  /\/attachments\/presign$/,
  /\/invitations?(\/|$)/,
];

export function isSecretBearingRoute(pathname: string): boolean {
  return SECRET_BEARING_ROUTES.some((pattern) => pattern.test(pathname));
}

/**
 * Routes that accept a body larger than the rest of the API, with the most the route itself accepts.
 * The idempotency middleware hashes the whole body, so it must refuse an oversize one itself: the
 * route's own `bodyLimit` runs after it and would otherwise only see a body already fully buffered.
 * A route not listed here keeps the unchanged behaviour (no cap in this layer).
 */
const ROUTE_BODY_LIMITS: ReadonlyArray<{
  method: string;
  pattern: RegExp;
  maxBytes: number;
}> = [
  {
    method: "POST",
    pattern: /^\/api\/import-sources\/?$/,
    maxBytes: IMPORT_SOURCE_BODY_LIMIT_BYTES,
  },
];

export function idempotencyBodyLimit(
  method: string,
  pathname: string,
): number | undefined {
  const upper = method.toUpperCase();
  return ROUTE_BODY_LIMITS.find(
    (entry) => entry.method === upper && entry.pattern.test(pathname),
  )?.maxBytes;
}

/**
 * Reads at most `maxBytes` of the body: an oversize `Content-Length` is refused without reading
 * anything, and a body with no or a false length is cut off as soon as it passes the cap. Returns
 * `null` when the cap was exceeded.
 */
async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = request.clone().body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      // Not awaited: cancelling one branch of a cloned body settles only once the other branch is
      // cancelled too, and nothing reads the original until the cap has passed.
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_IN_FLIGHT_LEASE_MS = 60 * 1000;
const KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;
const MAX_STORED_BODY_BYTES = 256 * 1024;

export type IdempotencyActor = {
  actorType: "api_key" | "user";
  actorId: string;
};

export type IdempotencyScope = IdempotencyActor & { key: string };

export type IdempotencyReservation =
  | { kind: "reserved"; token: string }
  | { kind: "replay"; status: number; body: string }
  | { kind: "in_flight" }
  | { kind: "mismatch" };

/** Durable store contract; `idempotency.repository.ts` is the PostgreSQL implementation. */
export interface IdempotencyStore {
  /**
   * Atomically reserves `(actorType, actorId, key)` for this request, or reports the
   * existing row. An expired row (stored response past 24 h, or abandoned in-flight lease)
   * is replaced by the new reservation.
   */
  reserve(
    input: IdempotencyScope & {
      token: string;
      route: string;
      requestHash: string;
      leaseMs: number;
    },
  ): Promise<IdempotencyReservation>;
  /** Stores the response for the reservation `token`; no-op if it was taken over. */
  complete(
    input: IdempotencyScope & {
      token: string;
      status: number;
      body: string;
      ttlMs: number;
    },
  ): Promise<void>;
  /** Deletes the in-flight reservation `token`; no-op if it was taken over. */
  release(input: IdempotencyScope & { token: string }): Promise<void>;
}

/** Process-local store for unit tests and single-process tooling. Not for production. */
export function createMemoryIdempotencyStore(
  now: () => number = Date.now,
): IdempotencyStore & { size(): number } {
  type Row = {
    token: string;
    route: string;
    requestHash: string;
    state: "in_flight" | "done";
    status: number | null;
    body: string | null;
    createdAt: number;
    expiresAt: number;
  };
  const rows = new Map<string, Row>();
  const id = (scope: IdempotencyScope) =>
    `${scope.actorType}\u0000${scope.actorId}\u0000${scope.key}`;
  return {
    size: () => rows.size,
    async reserve(input) {
      const current = rows.get(id(input));
      if (!current || current.expiresAt <= now()) {
        const createdAt = now();
        rows.set(id(input), {
          token: input.token,
          route: input.route,
          requestHash: input.requestHash,
          state: "in_flight",
          status: null,
          body: null,
          createdAt,
          expiresAt: createdAt + input.leaseMs,
        });
        return { kind: "reserved", token: input.token };
      }
      if (
        current.route !== input.route ||
        current.requestHash !== input.requestHash
      )
        return { kind: "mismatch" };
      if (
        current.state === "done" &&
        current.status !== null &&
        current.body !== null
      )
        return { kind: "replay", status: current.status, body: current.body };
      return { kind: "in_flight" };
    },
    async complete(input) {
      const current = rows.get(id(input));
      if (!current || current.token !== input.token) return;
      if (current.state !== "in_flight") return;
      rows.set(id(input), {
        ...current,
        state: "done",
        status: input.status,
        body: input.body,
        expiresAt: current.createdAt + input.ttlMs,
      });
    },
    async release(input) {
      const current = rows.get(id(input));
      if (current?.token === input.token && current.state === "in_flight")
        rows.delete(id(input));
    },
  };
}

/** The authenticated caller the key is scoped to, from the runtime's context variables. */
export function idempotencyActor(c: Context): IdempotencyActor | undefined {
  const apiKey = c.get("apiKey") as { id?: unknown } | undefined;
  if (apiKey && typeof apiKey.id === "string" && apiKey.id)
    return { actorType: "api_key", actorId: apiKey.id };
  const userId = c.get("userId") as unknown;
  if (typeof userId === "string" && userId)
    return { actorType: "user", actorId: userId };
  return undefined;
}

/** SHA-256 over method, path, query and raw body bytes; lowercase hex. */
export function idempotencyRequestHash(input: {
  method: string;
  path: string;
  search: string;
  body: Uint8Array;
}): string {
  const hash = createHash("sha256");
  hash.update(
    `${input.method.toUpperCase()}\n${input.path}\n${input.search}\n`,
  );
  hash.update(input.body);
  return hash.digest("hex");
}

export type IdempotencyMiddlewareOptions = {
  store: IdempotencyStore;
  ttlMs?: number;
  leaseMs?: number;
  newToken?: () => string;
};

export function idempotencyKeyMiddleware(
  options: IdempotencyMiddlewareOptions,
) {
  const ttlMs = options.ttlMs ?? IDEMPOTENCY_RESPONSE_TTL_MS;
  const leaseMs = options.leaseMs ?? IDEMPOTENCY_IN_FLIGHT_LEASE_MS;
  const newToken = options.newToken ?? randomUUID;
  return async (c: Context, next: Next) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined) return next();
    if (!KEY_PATTERN.test(key))
      throw new HTTPException(400, { message: "idempotency_key_invalid" });
    const actor = idempotencyActor(c);
    // The app-wide auth guard runs first; with no caller there is nothing to scope a key to.
    if (!actor) return next();

    const url = new URL(c.req.url);
    const limit = idempotencyBodyLimit(c.req.method, url.pathname);
    const body =
      limit === undefined
        ? new Uint8Array(await c.req.raw.clone().arrayBuffer())
        : await readBodyCapped(c.req.raw, limit);
    // Before any reservation: the key stays usable, and nothing past the cap was buffered.
    if (body === null)
      return c.json({ message: "Request body too large" }, 413);
    const scope: IdempotencyScope = { ...actor, key };
    const route = `${c.req.method.toUpperCase()} ${c.req.routePath || url.pathname}`;
    const reservation = await options.store.reserve({
      ...scope,
      token: newToken(),
      route,
      requestHash: idempotencyRequestHash({
        method: c.req.method,
        path: url.pathname,
        search: url.search,
        body,
      }),
      leaseMs,
    });
    if (reservation.kind === "replay") {
      return c.body(reservation.body, reservation.status as 200, {
        "content-type": "application/json; charset=UTF-8",
        "idempotent-replayed": "true",
      });
    }
    if (reservation.kind === "in_flight")
      throw new HTTPException(409, { message: "idempotency_key_in_flight" });
    if (reservation.kind === "mismatch")
      throw new HTTPException(422, { message: "idempotency_key_reused" });

    const release = () =>
      options.store.release({ ...scope, token: reservation.token });
    try {
      await next();
    } catch (error) {
      await release();
      throw error;
    }
    const response = c.res;
    const contentType = response.headers.get("content-type") ?? "";
    // Every 2xx JSON response is stored and replayed (the contract's "a repeat returns the
    // original response"), EXCEPT responses of secret-bearing routes (step-up nonces, rotated
    // tokens, signed URLs, API keys, MFA material): their bodies are never persisted, the key
    // is released, and a keyed retry simply runs again.
    if (
      response.status < 200 ||
      response.status > 299 ||
      isSecretBearingRoute(url.pathname) ||
      !contentType.toLowerCase().startsWith("application/json")
    ) {
      await release();
      return;
    }
    const text = await response.clone().text();
    if (Buffer.byteLength(text, "utf8") > MAX_STORED_BODY_BYTES) {
      await release();
      return;
    }
    try {
      JSON.parse(text);
    } catch {
      await release();
      return;
    }
    try {
      await options.store.complete({
        ...scope,
        token: reservation.token,
        status: response.status,
        body: text,
        ttlMs,
      });
    } catch {
      // The request itself committed; answer it. The unstored reservation lapses with its
      // lease, after which a keyed retry reaches the pending-action layer (409 pending_approval).
    }
  };
}
