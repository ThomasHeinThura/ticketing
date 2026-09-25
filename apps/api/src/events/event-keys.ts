/**
 * The event-key registry — `docs/01-architecture/events.md` § "Catalogue",
 * transcribed.
 *
 * events.md is the single authoritative home for event keys (AGENTS.md do-not 11).
 * Until #360 this repository had no code-level set of them: `check:events`
 * (`scripts/ci/check-events.mjs`) derives its "published" side by scanning for
 * `publishEvent(...)` literals and its "declared" side by scraping events.md's prose,
 * and nothing could reject an event-shaped-but-unregistered key at runtime. The audit
 * writer is the first consumer — `docs/03-features/audit-trail.md`'s rule is "where a
 * domain event exists for the mutation, the audit action is that event's key" — and
 * `validateAction` now accepts the union of the audit-only catalogue
 * (`apps/api/src/audit/actions.ts`) and this set.
 *
 * Transcription discipline, the same shape `actions.ts` documents for its own
 * catalogue:
 *   - adding or removing a key is events.md first, this set second, in the same
 *     change;
 *   - `tests/api/events/event-keys.test.ts` parses the Catalogue's Key column and
 *     fails if the two sets differ in EITHER direction — a key deleted from the doc
 *     but left here is caught too;
 *   - this set covers the target vocabulary's Catalogue only. events.md's
 *     "Inherited compatibility vocabulary" section lists the kaneo-era keys still
 *     being migrated (`task.*`, `comment.*`); those are deliberately NOT members —
 *     a merged route may not write an audit row under a retired key, and the
 *     migration tracked in events.md is what replaces them.
 *
 * Sorted alphabetically; events.md groups the same keys by section.
 */
export const EVENT_KEYS = new Set<string>([
  "api_key.auto_disabled",
  "approval.decided",
  "approval.expired",
  "approval.expiring",
  "approval.requested",
  "approval.withdrawn",
  "automation.run_failed",
  "budget.threshold_reached",
  "identity.deprovisioned",
  "identity.provisioned",
  "identity.request_denied",
  "identity_connection.changed",
  "import.chunk_completed",
  "pending_action.decided",
  "pending_action.executed",
  "pending_action.requested",
  "prerequisite.overdue",
  "project.archived",
  "project.created",
  "sla.at_risk",
  "sla.breached",
  "sla.met",
  "sla.missed",
  "submission.accepted",
  "submission.declined",
  "submission.received",
  "submission.replied",
  "submission.withdrawn",
  "webhook.auto_disabled",
  "work_item.assigned",
  "work_item.commented",
  "work_item.created",
  "work_item.deleted",
  "work_item.due_soon",
  "work_item.escalated",
  "work_item.mentioned",
  "work_item.overdue",
  "work_item.transitioned",
  "work_item.unassigned",
  "work_item.unblocked",
  "work_item.updated",
  "workspace.created",
]);
