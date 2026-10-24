import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import type { NotificationRecipientCandidate } from "./fanout";
import { configuredMentionChannels } from "./fanout.repository";
import { canReadNativeInboxCandidate } from "./native-inbox-reach";
import {
  findCurrentNotificationResource,
  findNotificationPerson,
  findWorkItemAssigneeId,
  listProjectLeadPersonIds,
} from "./repository";

/**
 * `SLA-16` / `NO-21` recipients for `sla.at_risk` and `sla.breached` (feature-contracts-p4.md):
 * the assignee and the project leads, plus the first stakeholder of the escalation path on a
 * breach (`NO-22`, "notify the first immediately"). `sla.met` / `sla.missed` have no
 * notification audience (events.md `N` column), so they are never resolved here.
 *
 * Only staff are ever written an inbox row: SLA state is internal (`EV-5`, customer audience
 * excludes `sla.*`). Every candidate goes through the same identity, reach and read-capability
 * evaluators as the inbox read, so someone who lost access since the assignment is dropped.
 * The actor is excluded by the caller's fan-out (`system` for the scanner), and a person who
 * would receive the row twice is collapsed to one entry, the most direct role first.
 */

export type SlaRecipientRole = "assignee" | "lead" | "escalation";

const METRIC_LABEL: Record<string, string> = {
  first_response: "first response",
  resolution: "resolution",
};

export function slaMetricLabel(metric: unknown): string {
  return (typeof metric === "string" && METRIC_LABEL[metric]) || "SLA";
}

export function slaProjection(
  kind: "sla.at_risk" | "sla.breached",
  role: SlaRecipientRole,
  key: string,
  payload: Record<string, unknown>,
): { title: string; body: string } {
  const metric = slaMetricLabel(payload.metric);
  if (role === "escalation") {
    return {
      title: "SLA breach escalated to you",
      body: `${key} has breached its ${metric} target and is escalated to you.`,
    };
  }
  if (kind === "sla.at_risk") {
    const pct =
      typeof payload.consumedPct === "number"
        ? ` (${Math.round(payload.consumedPct)}% consumed)`
        : "";
    return {
      title: "SLA at risk",
      body: `${key} is at risk of breaching its ${metric} target${pct}.`,
    };
  }
  return {
    title: "SLA breached",
    body: `${key} has breached its ${metric} target.`,
  };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Pure ordering and de-duplication; the most direct role wins, one entry per person. */
export function planSlaRecipients(input: {
  assigneeId: string | null;
  leadIds: readonly string[];
  escalationPersonIds: readonly string[];
}): { personId: string; role: SlaRecipientRole }[] {
  const ordered: { personId: string; role: SlaRecipientRole }[] = [];
  if (input.assigneeId)
    ordered.push({ personId: input.assigneeId, role: "assignee" });
  for (const personId of input.leadIds)
    ordered.push({ personId, role: "lead" });
  for (const personId of input.escalationPersonIds)
    ordered.push({ personId, role: "escalation" });
  const seen = new Set<string>();
  return ordered.filter(({ personId }) => {
    if (seen.has(personId)) return false;
    seen.add(personId);
    return true;
  });
}

/**
 * Resolver for one SLA event. `escalationPersonIds` are the stakeholders to notify as the
 * escalation path in this same fan-out (the first one when a breach starts a walk; exactly
 * the due stakeholder when `reminder-scan` advances it). `onlyEscalation` suppresses the
 * assignee and leads, who were already notified by the original event.
 */
export function slaEventRecipientResolver(options: {
  escalationPersonIds?: readonly string[];
  onlyEscalation?: boolean;
}) {
  return async (
    tx: DbTransaction,
    event: DomainEventEnvelope<Record<string, unknown>>,
  ): Promise<readonly NotificationRecipientCandidate[]> => {
    if (event.kind !== "sla.at_risk" && event.kind !== "sla.breached")
      return [];
    const kind = event.kind;
    const workItemId = nonEmptyString(event.payload.workItemId);
    const key = nonEmptyString(event.payload.key);
    if (
      !workItemId ||
      !key ||
      !("workspaceId" in event.scope) ||
      !event.scope.workspaceId ||
      !event.scope.projectId
    )
      return [];
    const { workspaceId, projectId } = event.scope;

    // The audience is resolved from the work item as it is now, not as the event recorded it.
    const resource = await findCurrentNotificationResource(tx, {
      resourceType: "work_item",
      resourceId: workItemId,
      eventKind: kind,
      canonicalWorkItem: { id: workItemId, key },
    });
    if (
      !resource ||
      resource.workspaceId !== workspaceId ||
      resource.projectId !== projectId
    )
      return [];
    const assignee = await findWorkItemAssigneeId(tx, workItemId);
    const planned = planSlaRecipients({
      assigneeId: options.onlyEscalation ? null : assignee,
      leadIds: options.onlyEscalation
        ? []
        : await listProjectLeadPersonIds(tx, { projectId, workspaceId }),
      escalationPersonIds:
        kind === "sla.breached" ? (options.escalationPersonIds ?? []) : [],
    });
    if (planned.length === 0) return [];
    const channels = await configuredMentionChannels(tx);

    const candidates: NotificationRecipientCandidate[] = [];
    for (const { personId, role } of planned) {
      const person = await findNotificationPerson(tx, personId);
      if (!person?.active || !person.userId || person.side !== "staff")
        continue;
      const identity = await resolveIdentity(
        { userId: person.userId, credential: "session" },
        tx,
      );
      if (!identity || identity.personId !== personId) continue;
      if (
        !canReadNativeInboxCandidate(
          identity,
          {
            userId: person.userId,
            personId,
            resourceType: "work_item",
            resourceId: workItemId,
            kind,
          },
          resource,
          await projectAncestryFor(
            tx,
            identity,
            resource.workspaceId,
            resource.projectId ?? "",
          ),
          await projectOwnerTeamFor(
            tx,
            identity,
            resource.workspaceId,
            resource.projectId ?? "",
          ),
        )
      )
        continue;
      candidates.push({
        personId,
        resourceType: "work_item",
        resourceId: workItemId,
        ...slaProjection(kind, role, key, event.payload),
        channels,
      });
    }
    return candidates;
  };
}
