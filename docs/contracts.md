# Maintained integration contracts

These are distilled contracts used by current implementation work. Original requirement references remain in [requirements.md](requirements.md); archived files stay unchanged. Implemented behavior and acceptance evidence are reported separately in [status.md](status.md).

## Work-item relations

Source: original relations/hierarchy RH-1–4, RH-16–19 and edge cases; activity CA-7; pending actions PA-1/PA-4; the original data-model row `work_item_relation`.

- Store canonical `work_item_relation` edges using `source_id`, `target_id`, `type`, plus the original common identifier/timestamp conventions. Both endpoints belong to the same workspace; projects may differ. Enforce that boundary in the database and API.
- Five stored types: `relates`, `blocks`, `duplicates`, `precedes`, `requires`. Only `relates` is symmetric. Inverse display labels are `blocked_by`, `duplicated_by`, `follows`, `required_by`; they are not additional stored types.
- An inverse-labelled entry normalises to the same canonical edge: “B blocked by A” means A blocks B. Repeating that edge is idempotent. A true opposite edge “B blocks A” differs from A blocks B; RH-19 permits this cycle and requires a warning on both ends.
- A self-edge returns 422. Creating/removing an edge requires current update permission and reach on both endpoints. Reads expose visible peers and only a count for inaccessible peers; hidden keys, titles and IDs never leave the API. Soft-deleted peers are omitted while deleted; restoration restores their relation. Hard purge removes edges by the declared foreign-key lifecycle.
- Use existing internal activity `verb=updated`, `field=relation` on both endpoints and the declared generic `work_item.updated` field-change event. Do not invent relation-specific event/audit identifiers. Activity and viewer-facing change payloads contain relation type/direction without inaccessible peer identities. The declared `work_item.unblocked` event fires once when the last open blocker closes or is removed, including concurrent closure; reopening permits a later unblock event. Serialize workspace graph changes before endpoint locks. Native inbox payloads identify only the blocked item. Internal outbox records retain the declared former blocker identifier; future external delivery must project it according to current recipient reach. Real database lifecycle tests are required; external delivery remains unverified.
- User removal requests a pending action. Approval/execution revalidates both endpoints, tenant, credentials and permissions in the same transaction as deletion and action completion. No direct user deletion bypass.
- Relations use original Kaneo task-section composition, real scoped search and persisted APIs. Picker/collapse state is URL state; removal leads to the existing pending-action confirmation surface.

Implemented API surface: `GET`/`POST /api/work-items/{key}/relations` and pending-action-backed `DELETE /api/work-items/{key}/relations/{id}`. The picker uses `GET /api/work-items/{key}/relation-candidates?q=&cursor=&limit=` with literal key/title search, bounded pages, opaque cursors and current update authority on both endpoints. Runtime evidence and remaining acceptance limits are recorded in status.md.

## Work views

Original Kaneo presentation renders canonical `work_item` records without shadow `task` copies. Board Sort requests real server order and cursor pages; do not sort a partial loaded result to imply a complete global ordering. Manual rank mutation is enabled only in ascending position order. Other sorts retain workflow transitions without hidden rank writes. Structured search does not implement position ordering: filtered board position requests resolve to key ascending and the control displays that effective selection.

The grouped list retains a table fallback for partial records, unavailable states and hierarchy/configurable columns. These are visible integration limits, not acceptance of missing feature parity.

## SLA scanning and completed outcomes

- `sla-scan` runs every five minutes with the existing five-minute database lease. It evaluates live, unresolved, unarchived, undeleted work items using their persisted policy-version pin, service calendar and pauses; later policy bindings never repin existing items. Archived/deleted projects are excluded.
- `work_item_sla_cache` stores exactly `(work_item_id, metric, state, due_at, computed_at)`, keyed by item and metric. Its six states are `none`, `ok`, `at_risk`, `breached`, `met`, `missed`; detail remains authoritative by recomputing. Migration `0128_work_item_sla_cache` adds its checks, cascading item FK and state/due index.
- Each scan locks the item, then its live project, and atomically writes the cache and declared `sla.at_risk`/`sla.breached` outbox events only on transitions into those states. Concurrent/repeated workers cannot duplicate a crossing, even after lease expiry. Row revalidation after lock waits prevents alerts after completion wins the lock.
- Entering a `completed` group settles `sla.met`/`sla.missed` for stopped metrics inside the transition transaction, updates the same cache, and uses database time for resolution. The scanner never emits those completed outcomes. Missing first-response facts are not fabricated.
- Source/automated coverage: `sla-scan.test.ts` and existing SLA-policy/transition suites. Browser verification is reported separately. External delivery, escalation and job administration remain separate gaps; persisted outbox events do not establish notification delivery.

Retained references: SLA-3/14/15/15a, WF-17, the canonical cache row in the archived data model, and the archived event payload catalogue. The background-job candidate SQL predates persisted version pins; the scanner follows SLA-3 rather than resolving mutable bindings again.

## Runtime email provider

God Mode email configuration uses the existing `instance:manage_plugins` capability; writes and connection tests require a current administrator session on the agent origin. A saved row is authoritative, including explicit disablement. Bootstrap SMTP applies only when no row exists; read/decryption failures never fall back to it.

- GET returns configuration and fixed secret-presence metadata. Passwords are encrypted with the existing versioned per-row scheme and never returned. PATCH uses a configuration version; an omitted password preserves it, null clears it, and a string replaces it.
- Connection testing verifies SMTP without sending a message, with bounded deadlines, public destination validation and a durable per-user rate limit before connection. Its accounting must succeed before any network attempt.
- Actual sends use the runtime resolver, deterministic message identity and explicit recipients. Timeouts after DATA are reported as ambiguous, not false success. Mandatory privacy boundaries remain in force; local synthetic SMTP tests use an injected private test transport.
- Configuration audit failure follows retained AU-14: the mutation persists with failure observability and an administrator alert. This differs from the durable accounting precondition for a connection test.

This slice does not establish canonical notification fanout, outbox-worker execution, digest delivery or external-provider acceptance. See status.md for runtime evidence.

## Comment destinations and email preference links

The existing staff activity GET accepts an optional comment selector. It resolves that comment within the already-authorized work item and starts a bounded merged page at that comment; foreign/missing anchors share 404, deleted comments remain null-body tombstones, and focused cursors bind workspace/item/comment. Ordinary feed cursors remain supported. Canonical task URLs register `?comment={id}`; the actual row receives focus, and changing the activity filter clears that selection.

NO-2's handoff table is `notification_preference_handoff`: SHA-256 `handle_hash` primary key; audience; recipient person; event kind; channel; scope and optional scope ID; UTC creation and ten-minute expiry. Only verified selectors persist. Expired handles are credential-like coordination data, physically cleaned regardless of legal holds. The email token is purpose-bound, audience-bound and valid for 30 days; it never grants login or changes preferences.

Public agent/customer exchanges require the exact configured origin and correct host, rate-limit trusted source IPs, and require real double-submit CSRF whenever a session cookie is present. Invalid ambient cookies cannot downgrade to anonymous. Authenticated handoff GETs match the current audience/person and are read-only/no-store. Staff bootstrap removes the fragment before auth/navigation and sends it only in the signed exchange body; explicit authenticated saves edit the selected preference. Portal bootstrap and broader preference editors remain unimplemented.


## Kaneo board interaction and default workflow repair

Thomas's 22 October direction requires original Kaneo drag-and-drop within and between default board columns, without the added Move up / Move down / Change state buttons. Reuse existing DnD sensors, card overlay and keyboard support. Manual rank writes remain limited to ascending position order. Fetch real actor-specific transition offers, submit the offered template/version through the existing transition API, preserve guards/approvals/permissions, and restore the prior view after failure. A blocked move names its actual reason; an unavailable target does not trigger a guessed transition.

The source audit found built-in types seeded without workflows, making every stage change unavailable. Repair bootstrap by creating a validated active workspace default workflow on the existing five state templates, with non-self directed transitions and no extra guards/gates/effects; completed → unstarted is its single marked reopen transition. This default graph implements the requested free default-board movement. The `default` / `Default workflow` values are bootstrap data, editable through normal workflow configuration. Attach only built-in types with a null workflow. Never replace a custom/configured workflow, item state or item version. Serialize bootstrap per workspace, retain deterministic seed ownership, and report a key collision rather than adopt another workflow. Maintenance/CAB workflows remain authoritative. Source implementation and local acceptance are tracked separately in UI-08/10–12.


## Canonical creation and comment affordances

Original create controls must save through one canonical transaction. The initial state remains the project's real default, leaveable through the selected type's published workflow; it is displayed as a read-only Kaneo pill. Initial dates and label IDs require the existing scoped `work_item:update` authority; initial assignment reuses existing assign/self and active-roster rules. Existing initial-priority permission is unchanged. Invalid fields, lost authority or changed configuration reject creation without a partial item. Attachments require genuine scoped staging; legacy draft tasks or fabricated submissions are not substitutes. Dirty Cancel/Escape/backdrop uses the original discard confirmation; in-flight save is protected and successful save closes without asking to discard.

Activity adds authoritative comment-only `canEdit` / `canDelete`, `actorPersonId` and `actorDisplayName` projection. Resolve canonical person and retained user-ID authors unambiguously, within current reach; competing mappings fail closed and do not receive a guessed display name. No client-side user/person-ID casts. Existing history is retained. Preserve the selected implementation's user-ID convention for version editor/deleter metadata; the historical C13 record explicitly did not select the competing person-ID editor convention. Ownership and these metadata fields are different concerns. No new delete affordance ships before the corresponding durable pending action is implemented.


Comment deletion extends the existing pending-action registry: `action=delete`, `targetType=comment`, `routeKey=DELETE /api/comments/{id}`, click confirmation, executor `comment_deletion`. Request returns 202 and freezes exact comment/parent/versions and originating authority without deleting. Approval uses fresh reach, credential, author/window/moderation and concurrency checks in the execution transaction. Cancellation, expiry or invalidated authority/content leaves the comment intact. Existing tombstones/history and user-ID deleter metadata remain. Implementation and verification are tracked separately in status.md.

Attachment deletion uses the existing `delete` action, `attachment` target, `DELETE /api/attachments/{id}` route key and click confirmation. The request preserves the file; confirmation binds one exact attachment and its parent/revision to current reach, uploader/delete-any capability and the original credential ceiling. Public summary fields are `attachmentId`, `filename`, `mimeType`, `size`, `key`, `title`, `recoveryHours` (at least 24), `alreadyDeleted` and `requesterName`; storage locators are excluded. Approval soft-deletes transactionally without storage I/O. Cancellation, expiry, changed targets and lost authority preserve the attachment. Scheduled abandoned-upload cleanup remains exempt from interactive approval; failed uploads must not silently create pending approvals. A reachable recovery API/UI remains a separate open requirement; retained bytes alone do not prove user recovery.

## Canonical bulk integration (WI-24–27, AS-3)

The existing `/api/work-items/bulk` batch remains capped at 500 keys, with one transaction and permission/reach decision per item, safe failure reasons, per-item audit and one batch summary. Original Kaneo floating toolbar/command/calendar presentation supplies the controls; each action uses its own capability. Labels and dates require `work_item:update`; definition management is a separate permission.

Additive operations: `add_label`/`remove_label` with one `labelId` atomically preserve other labels and validate workspace/project catalogue, even a removal with no current link. `set_due_date` accepts a bounded canonical UTC date-time or `null`. Assignment optionally carries `expectedCurrentAssigneeIds`, an exact complete map of selected keys to the observed holder or `null`. Omitting it keeps unassigned-only claiming; supplying it uses the existing holder compare-and-set. The UI confirms replacement of every different current holder in one Kaneo dialog. No server-read holder substitutes for what the person confirmed. These are integration contracts, not a completion claim.


## Creation attachment staging (UI-15; AT-12/13 remain separately verified)

Reuse the original Kaneo editor/Paperclip/paste/drop and attachment presentation. Stage selected File objects only in browser memory before explicit Create; cancellation releases local previews and creates no shadow task, upload or pending deletion. The existing capability response adds optional `createAttachments`, computed strictly from current `attachment:create` at the requested workspace/project; `canCreateAttachments()` fails closed for absent/loading/denied responses. The attachment APIs still enforce current authority and reach.

After canonical creation confirms one key, use the existing presign → byte upload → complete APIs. Retain that key and each attachment ID/checkpoint: successful files are not replayed, and retry addresses failed files only. Reconcile ambiguous completion by exact attachment ID, never filename. A partial failure leaves the created item and successful files intact and explicitly reports what remains. Closing after creation is not an unsaved-draft discard or deletion. A lost create response is an unknown outcome, never an automatic repeated POST or a duplicate-prevention claim.

No blob URL enters persisted description. Durable inline attachment links require the existing description update permission/version checks; navigation continuation and byte progress are separate retained requirements. This bounded staging integration does not claim those unfinished behaviors or atomic item-plus-files creation.
