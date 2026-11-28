import type { TFunction } from "i18next";
import { ROLE_REFUSAL_CODES } from "@/fetchers/workspace-roles/refusal-codes";
import { HttpError } from "@/lib/http-error";

export type Body = Record<string, unknown>;

/** Other settings that still use a role nobody holds, as plain counted phrases. */
function referenceCounts(body: Body): [string, number][] {
  const refs = (body.references ?? {}) as Record<string, unknown>;
  const n = (key: string) => Number(refs[key] ?? 0);
  return [
    ["refWorkflowTransitions", n("workflowTransitions")],
    ["refAutomations", n("automations")],
    ["refIdentityMappings", n("oidcMappings") + n("scimMappings")],
  ];
}

export function roleReferencePhrases(t: TFunction, body: Body): string[] {
  return referenceCounts(body).flatMap(([key, count]) =>
    count > 0 ? [t(`roles:projectRoles.${key}`, { count })] : [],
  );
}

/** True when a role_in_use refusal names no holders, only other settings. */
export function isReferenceOnly(code: string | null, body: Body): boolean {
  return (
    code === "role_in_use" &&
    !(Number(body.holderCount ?? 0) > 0) &&
    referenceCounts(body).some(([, count]) => count > 0)
  );
}

/** One plain-words sentence for the approval dialog; the request-time dialog adds project links. */
export function roleRefusalText(
  t: TFunction,
  code: string,
  body: Body,
): string {
  if (code === "role_has_revoked_grants")
    return t("roles:projectRoles.blockedHistoryDescription", {
      count: Number(body.revokedGrantCount ?? 0),
    });
  if (code === "role_in_use") {
    if (isReferenceOnly(code, body))
      return `${t("roles:projectRoles.blockedRefsDescription")} ${roleReferencePhrases(t, body).join(", ")}.`;
    return `${t("roles:projectRoles.blockedInUseDescription", {
      count: Number(body.holderCount ?? 0),
    })} ${t("roles:projectRoles.blockedInUseProjects", {
      count: Number(body.projectCount ?? 0),
    })}.`;
  }
  return t("roles:projectRoles.blockedBuiltInDescription");
}

/** The role refusal a failed approval carries (`PendingActionRefusal`), or null for any other error. */
export function roleRefusalOf(cause: unknown): [string, Body] | null {
  if (!(cause instanceof HttpError)) return null;
  const { code, body } = cause as HttpError & {
    code?: unknown;
    body?: unknown;
  };
  return typeof code === "string" &&
    ROLE_REFUSAL_CODES.includes(code) &&
    body &&
    typeof body === "object"
    ? [code, body as Body]
    : null;
}
