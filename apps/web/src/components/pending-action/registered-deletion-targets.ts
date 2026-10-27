/** Generic name-bearing deletion flows registered by the server. */
export const REGISTERED_DELETION_TARGETS = [
  "organisation",
  "project",
  "workspace",
  "label",
  "project_label",
  "column",
  "canned_response",
  "milestone",
  "prerequisite",
  "document_link",
  "workspace_role",
  "invitation",
  "api_key",
  "custom_field",
  "team",
  "service",
  "time_entry",
  "cost_entry",
  "webhook",
  "automation",
  "kb_category",
  "cycle",
  "module",
  "dashboard",
  "project_page",
  "identity_connection",
  "request_type",
] as const;

export function registeredDeletionTarget(targetType: string) {
  return (
    REGISTERED_DELETION_TARGETS.find((target) => target === targetType) ?? null
  );
}
