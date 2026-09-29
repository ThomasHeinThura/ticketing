import { createHash } from "node:crypto";

export type PendingActionKind =
  | "delete"
  | "bulk_delete"
  | "purge"
  | "mcp_destructive";

export type ConfirmationKind =
  | "click"
  | "typed_name"
  | "typed_count"
  | "typed_count_step_up"
  | "typed_name_step_up";

export type PendingActionScope = {
  workspace_id: string | null;
  project_id: string | null;
  organisation_id: string | null;
};

export type PendingActionPayloadInput = PendingActionScope & {
  action: PendingActionKind;
  route_key: string;
  target_type: string;
  target_ids: readonly string[];
  confirmation_required: ConfirmationKind;
};

export type PendingActionPayload = PendingActionScope & {
  action: PendingActionKind;
  route_key: string;
  target_type: string;
  target_ids: string[];
  confirmation_required: ConfirmationKind;
};

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Non-finite payload number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("Pending-action payload must be JSON data");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Pending-action payload must contain plain objects");
  }
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => {
      const member = object[key];
      if (member === undefined) {
        throw new TypeError("Pending-action payload cannot contain undefined");
      }
      return `${JSON.stringify(key)}:${canonicalJson(member)}`;
    });
  return `{${entries.join(",")}}`;
}

/**
 * PA-4/PA-6 canonical payload. Sorting ids here makes request ordering irrelevant;
 * the caller must persist the returned object and hash together.
 */
export function canonicalPendingActionPayload(
  input: PendingActionPayloadInput,
): PendingActionPayload {
  const targetIds = [...input.target_ids].sort();
  if (targetIds.length === 0 || targetIds.some((id) => id.length === 0)) {
    throw new TypeError("A pending action must name at least one target id");
  }
  if (new Set(targetIds).size !== targetIds.length) {
    throw new TypeError("A pending action cannot contain duplicate target ids");
  }
  return {
    action: input.action,
    route_key: input.route_key,
    target_type: input.target_type,
    target_ids: targetIds,
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    organisation_id: input.organisation_id,
    confirmation_required: input.confirmation_required,
  };
}

export function hashPendingActionPayload(
  payload: PendingActionPayload,
): string {
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

/** PA's server-selected confirmation ladder. Unknown target types receive the
 * documented ordinary single-record click confirmation. */
export function requiredConfirmation(input: {
  action: PendingActionKind;
  targetType: string;
  targetCount: number;
}): ConfirmationKind {
  if (input.action === "purge") return "typed_name_step_up";
  if (input.action === "bulk_delete") {
    return input.targetCount > 50 ? "typed_count_step_up" : "typed_count";
  }
  if (input.action === "mcp_destructive") return "click";
  if (
    input.targetType === "project" ||
    input.targetType === "workspace" ||
    input.targetType === "organisation" ||
    input.targetType === "api_key" ||
    input.targetType === "webhook" ||
    input.targetType === "identity_connection" ||
    input.targetType.startsWith("auth.")
  ) {
    return "typed_name_step_up";
  }
  return "click";
}
