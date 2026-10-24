import { HTTPException } from "hono/http-exception";

/**
 * What kind of credential a stored key is, read from the `api_key` extension row (AK-7, AK-10).
 *
 * A key with no extension row is a legacy personal, non-MCP key: nothing about it was ever
 * declared otherwise, so it keeps its pre-P4 behaviour (`permissions` is its subset).
 */
export type ApiKeyKind = {
  readonly id: string;
  /** `service`: owned by a workspace, no person behind it. */
  readonly kind: "personal" | "service";
  readonly isMcp: boolean;
  readonly workspaceId: string | null;
  readonly personId: string | null;
  readonly ipAllowlist: readonly string[] | null;
  readonly rateLimitPerMinute: number | null;
  readonly disabledAt: Date | null;
  /**
   * The key's frozen capability subset from the extension row (`api_key.capabilities`). A
   * service key is evaluated against exactly this set (AK-7); `null` means none was stored and
   * grants nothing. A personal key's subset stays in `apikey.permissions` (AK-3).
   */
  readonly capabilities: readonly string[] | null;
};

export function legacyPersonalKeyKind(id: string): ApiKeyKind {
  return {
    id,
    kind: "personal",
    isMcp: false,
    workspaceId: null,
    personId: null,
    ipAllowlist: null,
    rateLimitPerMinute: null,
    disabledAt: null,
    capabilities: null,
  };
}

/**
 * PA-5a: a request made with a workspace service key has no approver (no `person_id`) and is
 * refused `403 no_approver` before anything is created. Service keys cannot delete.
 */
export function assertKeyHasApprover(key: Pick<ApiKeyKind, "kind">): void {
  if (key.kind === "service") {
    throw new HTTPException(403, {
      message:
        "no_approver: a workspace service key has no person to approve a deletion",
    });
  }
}

/**
 * F13 / PA-4: the pending-action `origin` of a key-credential request, derived from the
 * stored `is_mcp` flag and never from anything the caller supplies.
 */
export function pendingActionOriginForKey(
  key: Pick<ApiKeyKind, "isMcp">,
): "api" | "mcp" {
  return key.isMcp ? "mcp" : "api";
}
