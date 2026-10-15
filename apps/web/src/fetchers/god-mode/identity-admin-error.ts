import { HttpError } from "@/lib/http-error";

/** What an identity administration failure means to the screen, independent of its wire shape. */
export type IdentityAdminFailureKind =
  /** The caller is not a current instance administrator (or the session is not allowed). */
  | "denied"
  /** Fresh verification is unavailable, wrong, expired or already used. */
  | "step_up"
  /** The parent configuration version moved; the draft is stale. */
  | "conflict"
  /** A unique value (for example a mapped external group) already exists. */
  | "duplicate"
  | "not_found"
  | "invalid"
  | "rate_limited"
  | "unavailable"
  | "unknown";

type FailureBody = {
  message?: string;
  title?: string;
  currentVersion?: number;
  version?: number;
};

/**
 * An API failure with the parts the screens need. The API answers in two shapes: JSON bodies from
 * handlers (`{message}` or an RFC 9457-style `{title, status, currentVersion}`) and plain-text bodies
 * from thrown HTTP exceptions (for example `step_up_unavailable`). Neither is shown to the user.
 */
export class IdentityAdminError extends HttpError {
  readonly detail: string;
  /** The current parent version a 409 reports, when it reports one. */
  readonly currentVersion: number | null;

  constructor(
    status: number,
    message: string,
    detail: string,
    currentVersion: number | null,
  ) {
    super(status, message);
    this.name = "IdentityAdminError";
    this.detail = detail;
    this.currentVersion = currentVersion;
  }

  get kind(): IdentityAdminFailureKind {
    return classifyStatus(this.status, this.detail, this.currentVersion);
  }
}

function classifyStatus(
  status: number,
  detail: string,
  currentVersion: number | null,
): IdentityAdminFailureKind {
  const normalised = detail.trim().toLowerCase();
  if (status === 403)
    return normalised.includes("step_up") ? "step_up" : "denied";
  if (status === 404) return "not_found";
  if (status === 409) {
    if (currentVersion !== null || normalised.includes("version_conflict"))
      return "conflict";
    if (normalised.includes("version")) return "conflict";
    return "duplicate";
  }
  if (status === 422) return "invalid";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

export async function identityAdminFailure(
  response: Response,
  message: string,
): Promise<IdentityAdminError> {
  let detail = "";
  let currentVersion: number | null = null;
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as FailureBody;
      detail = String(parsed.message ?? parsed.title ?? "");
      const version = parsed.currentVersion ?? parsed.version;
      if (typeof version === "number" && Number.isSafeInteger(version))
        currentVersion = version;
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    // An unreadable body still has a status; the screens only need the status and kind.
  }
  return new IdentityAdminError(
    response.status,
    message,
    detail,
    currentVersion,
  );
}

export async function ensureIdentityAdminOk(
  response: Response,
  message: string,
): Promise<void> {
  if (!response.ok) throw await identityAdminFailure(response, message);
}

export function identityAdminFailureKind(
  error: unknown,
): IdentityAdminFailureKind {
  if (error instanceof IdentityAdminError) return error.kind;
  if (error instanceof HttpError) return classifyStatus(error.status, "", null);
  return "unknown";
}
