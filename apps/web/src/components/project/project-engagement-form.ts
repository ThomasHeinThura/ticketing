// Pure form logic for the project engagement controls (kind, support level, service
// calendar, RAG health). Kept free of React so it can be unit-tested and so the client
// validation mirrors the server in one place: `assertManagedServiceConfiguration` in
// apps/api/src/project/index.ts (PR-9, docs/03-features/projects-and-engagements.md).

export const ENGAGEMENT_KINDS = ["project", "managed_service"] as const;
export const SUPPORT_LEVELS = ["L1", "L2", "L3"] as const;
export const HEALTH_VALUES = ["red", "amber", "green"] as const;

export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];
export type ProjectHealth = (typeof HEALTH_VALUES)[number];

export type EngagementValues = {
  kind: EngagementKind;
  supportLevel: SupportLevel | null;
  serviceCalendarId: string | null;
};

export type EngagementErrors = {
  supportLevel?: "required";
  serviceCalendarId?: "required";
};

export function isEngagementKind(value: unknown): value is EngagementKind {
  return (ENGAGEMENT_KINDS as readonly unknown[]).includes(value);
}

export function isSupportLevel(value: unknown): value is SupportLevel {
  return (SUPPORT_LEVELS as readonly unknown[]).includes(value);
}

export function isProjectHealth(value: unknown): value is ProjectHealth {
  return (HEALTH_VALUES as readonly unknown[]).includes(value);
}

/** Narrow a project payload (the API types these as plain strings) to the form values.
 * An unknown value is treated as unset rather than trusted. */
export function toEngagementValues(project: {
  kind?: unknown;
  supportLevel?: unknown;
  serviceCalendarId?: unknown;
}): EngagementValues {
  return {
    kind: isEngagementKind(project.kind) ? project.kind : "project",
    supportLevel: isSupportLevel(project.supportLevel)
      ? project.supportLevel
      : null,
    serviceCalendarId:
      typeof project.serviceCalendarId === "string" &&
      project.serviceCalendarId.length > 0
        ? project.serviceCalendarId
        : null,
  };
}

/** PR-9 (blocking): a managed service needs a support level and a service calendar. */
export function validateEngagement(values: EngagementValues): EngagementErrors {
  if (values.kind !== "managed_service") return {};
  const errors: EngagementErrors = {};
  if (!values.supportLevel) errors.supportLevel = "required";
  if (!values.serviceCalendarId) errors.serviceCalendarId = "required";
  return errors;
}

export function hasEngagementErrors(errors: EngagementErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function isEngagementDirty(
  saved: EngagementValues,
  draft: EngagementValues,
): boolean {
  return (
    saved.kind !== draft.kind ||
    saved.supportLevel !== draft.supportLevel ||
    saved.serviceCalendarId !== draft.serviceCalendarId
  );
}

/** The three engagement fields exactly as the update route reads them. A cleared field is
 * sent as an explicit null: the server treats `undefined` as "leave unchanged". */
export function buildEngagementPayload(values: EngagementValues) {
  return {
    kind: values.kind,
    supportLevel: values.supportLevel,
    serviceCalendarId: values.serviceCalendarId,
  };
}

export type EngagementSaveFailure =
  | "forbidden"
  | "managedServiceIncomplete"
  | "calendarInvalid"
  | "notFound"
  | "generic";

/** Map an API failure to a translatable reason by status, never by echoing server text. */
export function classifyEngagementFailure(
  status: number | undefined,
  message: string | undefined,
): EngagementSaveFailure {
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 422) {
    return message?.includes("PR-9")
      ? "managedServiceIncomplete"
      : "calendarInvalid";
  }
  return "generic";
}
