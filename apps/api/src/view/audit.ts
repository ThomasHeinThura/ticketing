import type { JsonValue } from "@taskdesk/domain";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";

export type SavedViewAuditActor = {
  actorId: string;
  actorType: "person" | "api_key";
  apiKeyId?: string | null;
};

export type SavedViewAuditAction =
  | "saved_view.created"
  | "saved_view.updated"
  | "saved_view.pinned";

export type SavedViewAuditState = {
  name: string;
  scope: string;
  scopeId: string;
  visibility: string;
  sharedWithTeamId: string | null;
  layout: string;
};

export function savedViewAuditState(view: SavedViewAuditState): JsonValue {
  return {
    name: view.name,
    scope: view.scope,
    scopeId: view.scopeId,
    visibility: view.visibility,
    sharedWithTeamId: view.sharedWithTeamId,
    layout: view.layout,
  };
}

/**
 * AU-14: audit failure cannot roll back a completed saved-view mutation. This runs
 * after the mutation's transaction commits and reports failures at error level. The
 * shared audit-read path documents the metric and administrator-notification hooks as
 * observability work; this helper does not make an audit gap silent.
 */
export async function writeSavedViewAudit(input: {
  actor: SavedViewAuditActor;
  action: SavedViewAuditAction;
  workspaceId: string;
  projectId?: string | null;
  entityId: string;
  before?: JsonValue | null;
  after?: JsonValue | null;
}): Promise<void> {
  try {
    await appendAuditLog(db, {
      actorId: input.actor.actorId,
      actorType: input.actor.actorType,
      apiKeyId: input.actor.apiKeyId ?? null,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      action: input.action,
      entityType: "saved_view",
      entityId: input.entityId,
      before: input.before,
      after: input.after,
    });
  } catch (error) {
    console.error(`AU-14: ${input.action} audit write failed`, {
      workspaceId: input.workspaceId,
      entityType: "saved_view",
      entityId: input.entityId,
      error,
    });
  }
}
