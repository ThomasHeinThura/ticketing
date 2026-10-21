export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 401;
}

// Shared unauthorized redirect for both the React Query error cache and direct
// fetcher calls (e.g. route loaders) that bypass the QueryCache. Stashes the
// current pathname/search/hash so the sign-in page can return the user to
// where they were instead of dropping them on /dashboard.
export function handleUnauthorized(): void {
  const currentPath =
    window.location.pathname + window.location.search + window.location.hash;
  const target = currentPath
    ? `/auth/sign-in?redirect=${encodeURIComponent(currentPath)}`
    : "/auth/sign-in";
  window.location.replace(target);
}

const MAX_ERROR_DETAIL_LENGTH = 512;

/**
 * The API reports a refusal (`400`, `409`, `422` naming the field, `403`) as a short message.
 * Hono's `HTTPException` answers with plain text and other routes with a JSON body, so both
 * are read; anything long or non-printable is dropped for the generic message.
 */
export async function readErrorDetail(
  response: Response,
  fallback = "The request failed",
): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return fallback;
  }
  let detail: unknown = text;
  try {
    const body = JSON.parse(text) as { message?: unknown; detail?: unknown };
    detail = body.message ?? body.detail;
  } catch {
    // Not JSON: the text itself is the message.
  }
  if (typeof detail !== "string") return fallback;
  const trimmed = detail.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_ERROR_DETAIL_LENGTH ||
    [...trimmed].some((character) => character.charCodeAt(0) < 32)
  )
    return fallback;
  return trimmed;
}
