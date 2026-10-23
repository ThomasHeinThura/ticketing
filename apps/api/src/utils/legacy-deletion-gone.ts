import type { Context, MiddlewareHandler } from "hono";

/**
 * Retirement contract for a legacy DELETE route that used to remove a row immediately (P0
 * deletion audit, PA-1). The route keeps its reach and permission middleware, so a caller who
 * could not have deleted still gets 403/404, and then answers `410 Gone` with the same
 * Deprecation/Sunset headers `DELETE /api/task/{id}` uses and a `Link` to the canonical route
 * that records a pending action.
 */
const DEPRECATED_AT = "@1790812800";
const SUNSET = "Thu, 01 Apr 2027 00:00:00 GMT";

/** Sets the Deprecation/Sunset/Link headers of a retired deletion on the response. */
export function applyLegacyDeletionGoneHeaders(
  c: Context,
  successor: string,
): void {
  c.header("Deprecation", DEPRECATED_AT);
  c.header("Sunset", SUNSET);
  c.header("Link", `<${successor}>; rel="successor-version"`);
}

export function legacyDeletionGoneMiddleware(
  successor: string,
): MiddlewareHandler {
  return async (c, next) => {
    applyLegacyDeletionGoneHeaders(c, successor);
    await next();
  };
}

export function legacyDeletionGoneResponseHeaders(successor: string) {
  return {
    Deprecation: {
      description: "This compatibility operation was deprecated on 2026-10-01.",
      schema: { type: "string", example: DEPRECATED_AT },
    },
    Sunset: {
      description:
        "Earliest removal date, subject to two subsequent minor releases.",
      schema: { type: "string", example: SUNSET },
    },
    Link: {
      description: "Successor operation that records a pending deletion.",
      schema: {
        type: "string",
        example: `<${successor}>; rel="successor-version"`,
      },
    },
  } as const;
}

export function legacyDeletionGoneMessage(successor: string): string {
  return `This route was removed: it deleted immediately with no approval. Request the deletion through DELETE ${successor}, which records a pending action.`;
}
