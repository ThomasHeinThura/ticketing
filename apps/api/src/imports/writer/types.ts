import type { Transaction } from "../../database/executor";

/**
 * Fixed loss codes (IM-4: never partial-silent). A loss is something a source record carried that
 * the target could not take; it is reported with the source identity, never dropped quietly.
 * `unsupported_authorship_or_timestamp` is retained only so reports written before D3 still render.
 */
export const IMPORT_LOSS_CODES = [
  "author_unresolved",
  "assignee_unmatched",
  "assignee_not_eligible",
  "state_unmapped",
  "timestamp_invalid",
  "parent_cycle_broken",
  "parent_unavailable",
  "parent_depth_exceeded",
  "parent_not_allowed",
  "relation_target_unavailable",
  "relation_invalid",
  "comment_invalid",
  "custom_field_unmapped",
  "custom_field_invalid",
  "history_invalid",
  "attachment_download_failed",
  "attachment_too_large",
  "attachment_type_not_allowed",
  "attachment_content_mismatch",
  "attachment_limit_reached",
  "attachment_storage_unavailable",
  "provenance_duplicate",
] as const;
export type ImportLossCode = (typeof IMPORT_LOSS_CODES)[number];

export type ImportLossEntity =
  | "work_item"
  | "comment"
  | "attachment"
  | "relation"
  | "parent"
  | "custom_field"
  | "history"
  | "person";

/** One reported loss. `sourceUrl` is the original location (attachments), already URL-validated. */
export type ImportLoss = {
  code: ImportLossCode;
  sourceType: string;
  sourceId: string;
  entity: ImportLossEntity;
  entitySourceId?: string;
  sourceUrl?: string;
};

export const MAX_REPORTED_LOSSES = 1000;

export function isImportLossCode(value: unknown): value is ImportLossCode {
  return (IMPORT_LOSS_CODES as readonly string[]).includes(value as string);
}

/** Per-run state shared by the writers inside one commit transaction. */
export type ImportWriterContext = {
  tx: Transaction;
  workspaceId: string;
  /** The workspace's own organisation: placeholder people are created here, never elsewhere. */
  organisationId: string;
  projectId: string;
  runId: string;
  pluginId: string;
  /** Provenance `system`: the run's `sourceRef`. */
  system: string;
  /** The real write time, used for `imported_at`. */
  now: Date;
  /** normalised email -> resolved person (or null when unresolved), per transaction. */
  people: Map<
    string,
    { personId: string; kind: "matched" | "placeholder" } | null
  >;
  losses: ImportLoss[];
  stats: { placeholdersCreated: number };
};

export function recordLoss(ctx: { losses: ImportLoss[] }, loss: ImportLoss) {
  ctx.losses.push(loss);
}
