# 0015 — Membership grant provenance and effective-role projection

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** Thomas (approval required; not granted)

> This ADR remains proposed for Thomas's integrated P4 design review. Thomas's standing
> authorization permits implementation of the documented recommendation in a P3 batch;
> it is not ADR approval, finding closure, or acceptance of the 25 named tests. The
> migration must stop on any unresolved legacy row as specified below.

## Context

TaskDesk must reconcile direct administrator membership, a per-connection JIT default,
OIDC group mappings, and SCIM group mappings without turning independent sources into a
capability union. The existing target `membership` has one `role_id`, while its
`derived_from` placeholder can record only one SCIM source. Deleting that row when one group
is removed can erase authority another independent source still justifies; retaining it can
leave stale authority. OIDC group overage or omission also cannot safely be treated as the
last known current group set.

OIDC and SCIM are connection-scoped. OIDC group evidence is refreshed at a validated login;
SCIM evidence changes when an authenticated synchronization request arrives. There is no
upstream callback that makes every provider's removal instantly observable. A person can
have explicitly linked identities from more than one connection, so one connection's
claims cannot stand in for another's evidence. The current 30-second authority-cache bound
and immediate next-request session-table check remain distinct controls. A connection's
`max_role_rank` is its current ceiling: a committed decrease must retire that connection's
now-ineligible external grants and recompute stored authority atomically, while leaving
sessions valid and distinct from authority-cache invalidation.

This changes the authoritative RBAC storage contract and is expensive to reverse, so it
needs an ADR before implementation.

## Decision

**Proposed:** keep `membership` as one materialized effective role per
`(person_id, scope, scope_id)` and add an append-preserving `membership_grant` provenance
ledger. The grant ledger records `direct`, `jit_default`, `oidc_group`, or `scim_group`
source rows; it is never read as a list of roles and never produces capability union.

Add a separate `oidc_group_mapping`, keyed by `(identity_connection_id,
external_group_id)`, because an OIDC-only connection need not have SCIM configured. OIDC
group ids are immutable provider object ids; names are nullable display snapshots only.
OIDC and SCIM mappings may describe the same upstream object but remain separate grant
evidence.

### Grant provenance and validation

- A direct grant carries its `direct_origin` (`admin` or migration-only `system_backfill`);
  only `admin` carries `granted_by_person_id`. Direct grants alone may set `sees_all`.
- A JIT-default grant names its external identity and connection but no group mapping.
- An OIDC-group grant names its external identity, connection, and exactly one OIDC mapping.
- A SCIM-group grant names its external identity, connection, and exactly one SCIM mapping.
- External grants have no direct-grant fields and force `sees_all=false`. A source CHECK
  enforces this exact discriminator shape. `system_backfill` is available only to the
  forward migration, never to an API request.
- The writer validates current person and parent lifecycle, connection, mapping, person side,
  role scope, actual resource-owning organisation, forbidden capabilities, and `max_role_rank`
  using the shared [IP-22 source-validity invariant and parent-first total lock/retry protocol](../../03-features/identity-provisioning.md).
  Cross-row rules are not represented as if a SQL `CHECK` could enforce them.
- Every source addition or retirement preserves a grant row. A role or mapping change
  retires the old grant and inserts a new one; no in-place role escalation changes its
  provenance.

### Effective membership selection

For one person and scope, consider only active grants whose source remains valid, whose role
still exists in that scope and under the current connection ceiling, and whose external
identity is active. If a direct grant exists, it alone chooses the effective role. Otherwise
the valid external grant with greatest role rank wins. At equal rank,
`scim_group > oidc_group > jit_default` applies only when the tied grants have the same
`role_id`. Distinct role ids tied at the highest rank fail closed for that scope: materialize
no external effective membership and show an operator-visible conflict for an
administrator to resolve. Role-id sorting and capability union are forbidden. `sees_all`
is true only when the selected direct grant explicitly carries it.

The shared validity predicate, configuration/mapping/role transition matrix, lock-and-retry
protocol, source isolation, atomic projection/cache update, event/audit behavior and
existing-session distinction are defined once in
[IP-22](../../03-features/identity-provisioning.md); this proposal uses that invariant for
effective grant selection. Role-priority edits reproject all affected holders even when no
grant retires, and a ceiling increase never restores retired grant history without fresh
evidence from the source that owns it. ADR-0015 remains proposed for integrated P4 human
review; the documented recommendation may be implemented under Thomas's standing P3
authorization, subject to the legacy-row gate and all independent review gates.

The effective row has a unique `(person_id, scope, scope_id)` key. Before adding that
constraint, migration work audits duplicates and requires a deterministic,
owner-approved repair. A future cut-over first performs a read-only provenance preflight
over **every** legacy membership row before any DDL, backfill, uniqueness constraint, or
effective projection. A row can be classified only from durable evidence establishing its
exact source and the required grant fields: an explicit administrator grant (including an
invitation only where inviter, target, and grant are unambiguously linked), a
connection-bound JIT default, or a specific SCIM group membership. A valid
`derived_from` link may prove a SCIM group source; `derived_from IS NULL` does not prove a
direct grant because invitation, JIT, and SCIM memberships may also have null provenance.
Any ambiguous or unclassified row, including one with null `derived_from`, stops the
**entire migration before DDL or data changes** and requires explicit owner-approved,
per-row reconciliation. Never guess a direct grant, discard a row, or create a partial
effective projection. Migration proceeds only after every row is classified and duplicate
repairs are owner-approved. DDL, complete grant backfill, effective projection, and
constraints then run in one transaction; any failure rolls the whole cut-over back to the
unchanged pre-migration schema and membership data. Non-transactional DDL is not permitted
for this cut-over. Recovery supplies the missing approved classifications, reruns the
read-only preflight against unchanged legacy data, then retries the complete migration. The
existing lookup index remains.
`membership.derived_from` stops being written and stays null during transition; remove it
only in a documented forward migration after the grant ledger is authoritative.

#### Legacy-row classification and reconciliation gate

The preflight emits a private, deterministic inventory keyed by legacy `membership.id`,
including person/scope/scope id/role/`sees_all`/`derived_from`, the row's current values,
the exact evidence references and a digest of those values. It reads the entire legacy
table and the durable invitation, external-identity, connection, SCIM-group-member,
mapping and audit records needed for candidate sources. A classifier accepts a row only
if **one** source has an unbroken identity, target, role, scope and time linkage to the
row. An invitation is direct only when its accepted grant links the same inviter, person,
scope and role; an invitation email or accepted state alone is insufficient. A JIT
candidate needs a connection-bound external identity and a recorded default grant for
that same target and role. A SCIM candidate needs the exact group-member/mapping/identity
chain; a `derived_from` value alone is insufficient if that chain is broken. Historical
OIDC data lacking a source-specific link cannot be inferred from a current group claim.
Any zero-candidate, multiple-candidate, mismatched, duplicate or inconsistent row is
ambiguous, even when `derived_from` is null. Classifying a source also validates all
required target grant fields against the current canonical parents; an invalid target
stops the cut-over rather than being silently omitted.

For each ambiguous row, the owner supplies an explicit per-row reconciliation record:
legacy membership id and preflight digest, selected source kind, every required source
reference and direct origin/actor where applicable, the exact evidence and rationale,
and an explicit disposition for duplicate effective keys. The owner may require a
separate documented legacy-data correction before migration; a reconciliation cannot
invent external-identity or group provenance. A direct `system_backfill` classification
requires affirmative owner evidence that a direct administrative grant really existed;
it is never the default for a null `derived_from`. Keep the approval record private and
auditable; do not put identity payloads or email addresses in a migration log. The
preflight validates each record against fresh database evidence and its digest; changed
rows or stale records fail closed. It must account for every legacy row exactly once and
for every duplicate-key repair explicitly before the write phase. Run the final preflight
and transactional cut-over against one stable snapshot with writers blocked or an
equivalent serializable boundary, so classification cannot become stale between the two.
The migration cannot succeed with an unresolved inventory item; the operator receives a
bounded count and private ids for reconciliation, not a partial migrated database.

`scim_group_member` remains the SCIM group ledger. It points to its corresponding grant and
to the effective membership when one exists; under an equal-rank conflict both membership
pointers are null. Group removal retires only the matching SCIM grant and recomputes the
effective row. Removing one source never removes another source's valid grant.

### Reconciliation and revocation

- Every Entra login, whether or not JIT is enabled, checks the selected connection's exact
  configured app-role/`acct=0` admission rule before issuing a session; this also applies to
  existing invite- and SCIM-provisioned identities. A valid negative admission denies a new
  session and retires only that identity's OIDC/JIT grants; invalid/unverified tokens and
  invalid persisted configuration do not mutate grants. JIT remains a separate
  person/default-grant creation switch. This rule is IP-27 and the app role is never TaskDesk
  authority.
- Every validated OIDC login then reconciles only that external identity's OIDC groups from a complete,
  well-formed object-id `groups` array and refreshes its permitted JIT-default grant. It
  writes the grant delta, effective projection, provisioning event and audit rows in one
  transaction, commits, publishes cache invalidation, and only then issues the session.
- A valid token with absent, malformed, or overage groups supplies no group grants. Retire
  that identity's previous OIDC group grants; keep only an allowed JIT default and other
  independent grants; raise the existing provisioning event and operator warning for
  overage. Record `claim_missing` for absent/malformed groups, `claim_removed` for removals
  from a complete valid array, and `claim_overage` for the Entra overage form. Do not call
  Graph or retain stale groups. An invalid/unverified token causes no
  grant mutation. A valid token that fails current admission denies a new session and
  atomically retires only that identity's OIDC/JIT grants.
- Connection A's login neither applies A's group ids to connection B nor retires B's grants.
  B's upstream removal is observable only at B's next validated login, SCIM update, or
  administrative disable/change. Same email does not link identities; explicit linking
  remains the separately audited `IP-18` process.
- Mapping disable/change or mapped-role deletion immediately retires grants from that
  mapping and invalidates authority after commit. OIDC re-enable waits for later validated
  same-connection OIDC login with complete matching groups and current IP-27 admission;
  SCIM updates cannot restore OIDC grants. SCIM re-enable waits for later authenticated
  same-connection SCIM evidence; OIDC login cannot restore SCIM grants. Neither source
  revives historical rows merely because an administrator enables a mapping.
- Connection disable/delete revokes sessions issued through it and retires that connection's
  external grants, while preserving direct grants and grants from other connections.
- Global SCIM `active=false` marks the person inactive, revokes sessions and keys, and retires
  every external grant, including those from explicitly linked connections. Under the
  default `end_memberships` policy it also retires direct grants and removes effective rows.
  Under `keep_memberships`, direct grants/effective rows remain dormant while the person is
  inactive; external grants do not remain latent. Reactivation re-derives external authority
  only from current SCIM groups or a later validated OIDC login; revoked history is never
  restored automatically.

For every authority-changing write, use IP-22's total lock order and closure rediscovery/
retry; validate current caller, source/mapping/role and new configuration under those locks;
commit grant deltas, the materialized projection, and safe provisioning/audit records
together under the existing AU-14 audit-failure exception; then publish cache invalidation
after commit. If invalidation is lost, the documented 30-second authority-cache bound
remains. Ordinary role/policy edits change effective authority after invalidation but do not
revoke a live session. Session-table revocation is checked on the next request for lifecycle
transitions that explicitly revoke sessions. A failed transaction issues no new OIDC session
and publishes no partial grant state. Parent lifecycle changes use the same transaction: invalid
external target eligibility retires with existing `mapping_changed`; customer portal closure
also revokes customer sessions under the portal lifecycle rule. Direct grants remain independently
recorded, and restoring a parent or reopening the portal does not revive retired external grants
without fresh same-source evidence. This is the proposed storage rationale, not ADR approval or
runtime acceptance.

Use existing provisioning event keys `group.member_added`, `group.member_removed`,
`group.mapping_changed`, `connection.changed`, `request.denied`, and `auth.failed`.
Ceiling-policy retirement uses `group.mapping_changed`; connection configuration uses
`connection.changed`. The configuration mutation also writes the existing
`identity_connection.changed` event envelope/outbox row under EV-1. Bounded event detail may carry
source kind, connection id, external identity id, mapping id, affected scope/role ids and a
reason; it never stores raw claims or tokens. Grant rows and audit history keep the evidence
needed to explain changes without exposing provider payloads.

## Consequences

### Positive

- Removing one external source cannot erase a direct or independent grant.
- One materialized role preserves TaskDesk's established no-union RBAC rule.
- OIDC group removal and app-role removal become effective at the next validated login for
  that connection, while invalid tokens cannot revoke somebody else's current authority.
- Operators can inspect which source granted and retired authority; SCIM and OIDC retain
  separate evidence even for the same upstream group.
- Locks and a unique effective-row key define the concurrency boundary explicitly.

### Negative

- This adds tables, indexes, migration/backfill work, and another projection that must stay
  transactionally consistent with the grant ledger.
- An upstream OIDC removal remains active until that connection's next validated login;
  without SCIM, TaskDesk cannot observe an upstream change between logins.
- Equal-rank distinct-role conflicts intentionally remove external effective access until
  an administrator fixes the mapping.
- `keep_memberships` retains direct grants as dormant rows for inactive people, which needs
  careful enforcement at every resolver and administrative screen.

### Neutral

- The named P3 acceptance inventory remains 25 tests. Grant provenance, login reevaluation,
  concurrency, and migration evidence are subcases; this ADR does not claim they exist or
  have run.
- The 30-second authority-cache bound, current MFA policy and step-up requirements remain
  governed by their existing contracts; this proposal adds no MFA or step-up exception.
- No external identity source can grant `instance:admin`, `sees_all`, customer-to-staff
  movement, a role above its connection ceiling, or scope outside its connection.

## Alternatives considered

- **Keep only one `membership.derived_from` value.** Rejected: it cannot represent multiple
  independent valid sources, so one source's removal either erases another's authority or
  leaves stale authority.
- **Store multiple role names or union capabilities on `membership`.** Rejected: violates
  the established exactly-one-role contract and creates implicit capability unions.
- **Treat the last OIDC group claim as current until another is supplied.** Rejected: absent,
  malformed, or overage claims would retain stale privilege; invalid claims could also be
  mistaken for safe removal evidence.
- **Query Microsoft Graph during login overage.** Rejected for the first release: expands
  credentials, dependencies, failure modes, and network authority. Overage fails closed for
  group grants and is surfaced to an operator.
- **Revoke all of a person's grants when any connection changes.** Rejected except the
  explicit global `person.active=false` lifecycle transition: connection A is not evidence
  about B, and unrelated direct/SCIM grants must remain independent.
