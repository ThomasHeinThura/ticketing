# Central migration replay ledger

**Verified:** 2026-10-09 against live GitHub and fetched source refs. **Accepted `main`:**
`3096cb044bdf6ae98488bfc385f532fa6386343a`. Its Drizzle journal ends at **0087**. PR #602
(P0) is still blocked at `12d9f899a3437a601e0da22a3c8b25ba9a70f430`, based on that accepted
main. Offline comparison verified all 88 accepted SQL files and their ordered journal entries
are byte-for-byte equal at #602. No post-0087 migration is accepted or allocated here.

This ledger identifies candidate semantic units, source owners and dependencies. Its
`provisional` numbers are comparison labels only. Inclusion set, dependency order and final
numbers must be frozen together from the exact owner sources after P0 is accepted.

## Invariants

1. Preserve accepted migrations **0000–0087 byte-for-byte and in accepted journal order**.
   Exact ordered SQL SHA-256 evidence is in the private reconciliation packet referenced below.
2. Reconstruct from the then-accepted `main` and exact owner slices. Do not merge #589 or #598
   as whole trains; do not use branch ancestry as ownership proof.
3. Select only already-authorized, complete feature owners and their required schema units.
   A migration's presence in a train or snapshot is not proof that its capability is selected.
4. Deduplicate SQL by exact bytes first. For known saved-view variants, deduplicate only after
   the documented breakpoint/whitespace normalization and full ordered-statement comparison.
   Preserve each original path, source SHA, blob and SQL hash in the crosswalk.
5. Freeze selected units and dependency DAG before assigning a contiguous final tail beginning
   at 0088. Replay every selected semantic operation once. Regenerate every snapshot and the
   journal from the composed schema; do not transplant stale snapshots.
6. Do not apply provisional migrations to persistent DEV or customer databases. This record
   authorizes no migration allocation, database replay, applied-history rewrite, merge or
   feature acceptance.

## Candidate source/owner matrix

Rows describe captured candidate heads, not acceptance. Live heads and bases were queried on
2026-10-09. A train copy is a comparison witness only; the named owner source must be refreshed
and its actual migration extracted at replay time. `Hold` means no unit has been selected for
final replay.

| Provisional unit | Candidate PR / phase | Captured source SHA | Status / selected unit and source owner | Dependency | Next action |
|---|---|---|---|---|---|
| 0000–0087 | accepted `main` / foundation | `3096cb044bdf6ae98488bfc385f532fa6386343a` | Accepted immutable prefix; #602 `12d9f899a3437a601e0da22a3c8b25ba9a70f430` matches all 88 SQL bodies and ordered journal entries | Foundation | Preserve exact bytes/order; do not rewrite |
| 0088 | #589/#598 / P2 SLA | #589 `2350397b18f83ed417bf63d73970daacdbaae49c`; #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | Provisional SQL SHA `355060f6ad6eecc698f8da183da191502cc245e05f1ece02aa2230553d2e73e0`; creates SLA policy/version/goal objects and references service-calendar keys. **Owner unresolved across actual SLA source**; train is not owner | Service-calendar key prerequisite and SLA owner contract | Refresh #513 and exact SLA source; inspect actual unit/dependencies before considering inclusion |
| 0089 | #513 / P2 SLA | #513 `a319442f1804c1733c08bfb63157d6191199e801` | Provisional SQL SHA `308012d2d364adf45808f9908a0956c97fa31475315728a73441562880b80197`; candidate version-pinning unit, not a final ID | 0088 SLA policy/version | Extract from exact source and verify matching runtime schema |
| 0090 | #595 → #596 / P3 identity | #595 `197b19fcee0f76b3faf69d5f9b0bfde3d8bb07d3`; #596 `103dc906052852c246f9f7f6660a6b7f8d7d931c` | Provisional SQL SHA `0f3dfc7d3e17b837c984fdb255b1eabc93ff1be1da5a55588090e142a6e5d2b4`; identity-connection foundation, hold pending exact integrated source | P3 identity contract; precedes mappings and validated-login reconciliation | Refresh exact owner heads; include only with complete P3 source and reviews |
| 0091 | #595 → #596 / P3 identity | same as 0090 | SHA `077012bc477e03f79c1795dddfeb29dd2a8430864550654f8780c3afd183de16`; grant-provenance/SCIM token constraints; hold | 0090 and accepted membership/SCIM contract | Confirm source owner and schema semantics at composed source |
| 0092 | provisional train / P4 lifecycle | #589 `2350397b18f83ed417bf63d73970daacdbaae49c` | SHA `7acd9005efcfb7048c9e3efcacbf4b6d04499719a3a8778a90bda82fe2c644fe`; workspace lifecycle/step-up registry candidate; **no proven complete owner; hold** | Exact permission/spec owner required | Exclude unless existing authorized stage owner and source implementation are proven |
| 0093 | #595 → #596 / P3 identity | same as 0090 | SHA `50acbb4773658fd847f4c6684bdd9a87e150557c15498c56d5d3c02fc2dcc0b0`; membership uniqueness constraint; hold | Accepted membership semantics and identity owner | Verify duplicate/data behavior and exact owner schema |
| 0094 | #595 → #596 / P3 identity | same as 0090 | SHA `147bf48dafe118c230cb71dab8055a0c163d5ed8394f03c4ba22c9a44e018c9e`; step-up route registry candidate; hold | Exact identity administration policy contract | Verify policy registry and source-owner mapping before inclusion |
| 0095 | #595 → #596 / P3 SCIM | same as 0090 | SHA `4aeb725063b0d04b448a42f596877784b1ab44b0420b4dbb005eaaffa5ae8ea4`; directory profile candidate; hold | SCIM source/schema contract | Refresh exact SCIM owner and verify fields against runtime DTOs |
| 0096 | #598 / P2 catalogue/intake | #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | SHA `d5fbedf6d4456f4135d401f41c347f2c1de9f2344884b74616e393735d8f23ce`; mixed request/intake and shared objects. Select only request/intake-owned DDL; do not assign all objects to #598 | Existing workspace/schema contracts; request-type/intake implementation | Compare each CREATE/ALTER object with #598 schema owner and separate unrelated object owners |
| 0097 | #596 / P3 identity | #596 `103dc906052852c246f9f7f6660a6b7f8d7d931c` | SHA `fb127f288854c8a466062cc1325b81e47aae6bce739cf9daa61303121d7eeed4`; customer identity default-workspace restriction; hold | Identity assignment contract | Verify source and tenant boundary contract at composition |
| 0098 | #589/#598 / custom fields | #589 `2350397b18f83ed417bf63d73970daacdbaae49c` | SHA `cffbdc3e691730152bad23171e8fb1f7a64f6610f8cd29a3e7e1f16f9fd222ff`; four schema tables only. **Hold/exclude:** no complete API, repository, permission, UI, URL and test owner established | Complete existing feature owner required | Keep excluded unless full existing owner is identified and authorized; table carry-forward is not capability evidence |
| 0099 | #598 / P2 intake | #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | SHA `c233232e34e407616db2e27f13a17c5f858fb4a70e17e8b5378c062f24f73fa0`; staged submission/draft/backfill candidate; hold pending owner integration | 0096 request/intake objects | Verify backfill on accepted schema and pair with complete intake runtime/tests |
| 0100 | #598 / P2 catalogue | #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | SHA `d9170707a738e0e539b03f3e8dd87869c8a3533c46c5fa38c1e069e682b9c48d`; request-type auto-accept candidate; hold | Request-type version schema | Confirm exact accepted catalogue semantics and implementation |
| 0101 | #598 / P2 intake | #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | SHA `3af31b1044701713745c403c96393f0533fa2ebe1e9a47f90e57e9149b0f34cf`; submission numbering candidate; hold | 0099 staging | Verify sequence/transaction semantics with owner tests |
| 0102 | #598 / P2 intake | #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | SHA `0229167d3a5afc49bbd520d73256fd24c4b3e537d8f69c332193ab822cac7ec6`; staged attachment field key; hold | 0099 staging and submission attachment runtime | Verify DTO/runtime field parity and migration regression |
| 0103 | P1 work-item search owner / P1 | #589 comparison `2350397b18f83ed417bf63d73970daacdbaae49c` | SHA `cda71bcd6279ca87eeffad47fe121cc4a5ad43f65b73c387a6c729bcfccfd25a`; trigram index; **exact standalone owner unresolved** | Search extension/schema generation support | Identify existing owner; verify `pg_trgm` generation and operational lock impact before inclusion |
| 0104 | #513 / P2 SLA | #513 `a319442f1804c1733c08bfb63157d6191199e801` | SHA `caf1a885a0effac26c382a85b0ae08ccb632c34f92e71ff31278b0e9e349d88d`; SLA pause records; hold | 0088 SLA base | Verify SLA behavior owner and runtime schema |
| 0105 | #595 → #596 / P3 SCIM | #595 `197b19fcee0f76b3faf69d5f9b0bfde3d8bb07d3` | SHA `7aeb45b96537de0e4f41090077263625a505572ae7bb093a385f8628ca7695b9`; SCIM matching attributes; hold | SCIM profile/identity source | Match schema fields to exact SCIM DTO/contract |
| 0106 | #595 → #596 / P3 identity | #595 `197b19fcee0f76b3faf69d5f9b0bfde3d8bb07d3` | SHA `d981e24561f7933a56ec2d22d642a415c1e28e850248dcd26af8f04ee3acc572`; session connection link/step-up constraints; hold | 0090; identity session lifecycle | Verify concrete owner and authentication/session invariants |
| 0107 | #596 / P3 identity | #596 `103dc906052852c246f9f7f6660a6b7f8d7d931c` | SHA `2f470071393165ee4f987cdd5bf2d67e0ac2bea1dcf3abe8f198114c586037be`; grant revocation reason; hold | 0090/0091; validated-login reconciliation | Pair with exact grant reconciliation source and compatibility tests |
| 0108 | #595 → #596 / P3 identity | #595 `197b19fcee0f76b3faf69d5f9b0bfde3d8bb07d3` | SHA `16928d024a1791c6e34e6af6027624e9c6b9259dc2231262bdebf4b6098ba160`; step-up route additions; hold. Identity claims must not grant instance admin or global reach | Exact policy/step-up contract | Include only after permission contract and Sol security review are complete |
| 0109 | #608 / P4 Users | #608 `76b833be5b46589229a630738c5b436365eba409` | SHA `05e18a54b2476f29c4940f582ff053e53f5626ec4d82cd0c778cd4ac9af47529`; user-deactivation pending-action candidate; Thomas approved the legacy DTO compatibility outcome on 2026-10-09, while runtime/source-owner acceptance remains pending | Existing action/target vocabulary and pending-action contract; approved DTO mapping is canonical `delete`/`user`, resolving legacy `person` to `user` | Implement spec/source/regression changes on the exact owner source; preserve stored row/hash/proofs and legacy approval refusal; unresolved targets fail closed; validate legacy rows before replay selection |
| 0110 | #608 / P4 Users and outbox | same as 0109 | SHA `03549709f5955dd82b97fe69a2fd3fa2fd3bec343be9135cf9c3f9458418b86b`; instance-scoped outbox envelope; hold pending exact source/runtime acceptance under the approved constrained event contract | #608 canonical action prerequisite and approved event allowlist | Verify instance-event envelope, recipient/tenant invariants, and migration backfill against the latest owner source |
| 0111 | #608 / P4 Users and outbox | same as 0109 | SHA `28f96c060e5b14da71ca1f62eedb38664f75597b8870742f59147da5996702a4`; empty-organization instance-scope constraint; hold | 0110 semantics | Verify exact constraint behavior and existing data compatibility |
| 0112-A | #589/#598 / P2 SLA | #589 `2350397b18f83ed417bf63d73970daacdbaae49c`; #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | Train SQL SHA `82ec0a4fc1ce7a84c0fc7d0a58f654d6ef129e6007aaf705aab8006769f8c73a`; SLA workspace FKs; provisional 0112 only | SLA policy/calendar tables | Keep distinct from #608 0112; confirm fields and FK targets against exact SLA owner |
| 0112-B | #608 / P4 Users | #608 `76b833be5b46589229a630738c5b436365eba409` | `0112_users_pending_action_canonical_vocabulary.sql`, SHA recorded in private reconciliation packet; SQL body is distinct from train 0112; compatibility behavior approved, but unit remains unselected pending exact source/runtime acceptance | 0109 action migration and Thomas-approved canonical `delete`/`user` DTO mapping | Preserve as distinct source unit; do not reuse train tag/idx; implement and test approved legacy-row mapping, then refresh exact source before final allocation |
| 0113 | #513 / P2 calendar | #513 `a319442f1804c1733c08bfb63157d6191199e801` | SHA `374807a9b020b7db9e43ab2ce346a6e234f655a70f88a2a723e7a86da51c783a`; project managed-service-calendar fields; hold | Service-calendar schema, including required SLA keys | Extract current owner migration and compare each FK/index with current source schema |
| 0114 | #585 / P4 delivery | #585 `5a371451d2d05777a8815639b18cd2ac8085578b`; #594 `359d60bd31368cd04cc1aeab3ad5bcfade403f22` | SHA `b14ca71867554d7c5b58e75524715c8d89385ecf03c4f4d07a80852d6fa59fea`; notification delivery table/constraints. #589/#598 duplicate SQL. #585 snapshot is stale | Outbox delivery/runtime eligibility | Replay one owner SQL unit with exact delivery runtime; regenerate snapshot from final schema |
| 0115 | #585 / P4 delivery | same as 0114 | SHA `dee9faa8e4bedf4b03a7dff326c11c7a74140c8c46da2b6ea1c9a040b78a742a`; outbox timestamps; duplicate SQL in #589/#598 | 0114 delivery table | Replay once with #585/#594 source and regenerate snapshot |
| 0116 | #586 / P2 approvals | #586 `b67a865a4c798069ab26c5dba4fb6632e82d6e1e` | SHA `455f0f3cf2de9c17ba5f490c2836f6d912d82278358240b06662dc57da1bb958`; approval lifecycle candidate; hold pending exact source/reach/pending-action acceptance | Existing approvals, authority and pending-action contracts | Pair schema with exact API/domain/UI and integration regression; refresh approvals source |
| 0117 | provisional train / plugin config | #589 comparison `2350397b18f83ed417bf63d73970daacdbaae49c` | SHA `abdf5e53f720fcf00260f97563dc31c992df4c14df1a4fe552e179291ad9d26f`; no existing authorized feature owner proven; **exclude under feature freeze** | Explicit existing stage owner would be required | Keep excluded unless owner evidence changes through an authorized decision |
| 0118-A | #591 / P1 saved views | #591 `fd8d8274eb590efbb57123685880ec4ef979d9a9` | Owner SQL SHA `ac0de214635f2eea5e166214487b50fc6249cce0140d2f533fea0a5ab745315c`; saved-view and user-preference tables; hold pending full saved-view owner integration | Workspace/person/team schema; URL/route contract | Integrate exact #591 source. Its shared-key identity changes must stay with canonical permission owner |
| 0118-B | #589/#598 / P1 saved-view comparison | #589 `2350397b18f83ed417bf63d73970daacdbaae49c`; #598 `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | Train SQL SHA `b436272134357b6b5b7eb0a86352808b52f03244582abcbbb567b78fc8cb0134`; raw bytes differ from #591, but all 12 ordered statements match after breakpoint-boundary whitespace normalization. **Same semantic unit; retain one only** | Same as #591 | Preserve both provenance records; choose exact owner source, replay once, and regenerate snapshot |
| 0082 collision | #569 / P4 pending action | #569 `af6f755c7b2803136101aece8bbcc03f48a2bb75` | Branch-local `0082_pending_action_expiry_indexes.sql` collides with accepted `0082_service_calendar.sql`; distinct SQL. #569 remains based on an older P1 source, not accepted main | Existing pending-action base and exact P1 owner source | Do not include/renumber by itself; extract current unique index unit only after its parent source is accepted and test under central replay |

## Deterministic duplicate map and snapshot reconciliation

The offline comparison captured #589/#598 at `2350397b18f83ed417bf63d73970daacdbaae49c` /
`3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e`, #585 at
`5a371451d2d05777a8815639b18cd2ac8085578b`, #608 at
`76b833be5b46589229a630738c5b436365eba409`, #569 at
`af6f755c7b2803136101aece8bbcc03f48a2bb75`, and #591 at
`fd8d8274eb590efbb57123685880ec4ef979d9a9` (owner base captured as
`f4789aefd3c3d08595642414dda63770d8973f64`; refresh all heads before use).

- #589 and #598 have byte-identical SQL and snapshots across provisional 0088–0118. The
  deterministic unit key is the SQL SHA-256; emit one semantic unit with both source refs and
  retain the current owner-specific source as provenance. No train SQL becomes selected solely
  through duplication.
- #585 0114/0115 SQL matches the train, but its 0114/0115 snapshots each contain 89 tables;
  train 0114 has 96. The seven missing train tables are `custom_field`,
  `custom_field_section`, `custom_field_type_visibility`, `custom_field_value`,
  `policy_shadow_event`, `policy_shadow_tally`, and `sla_pause`. In addition, fieldwise JSON
  comparison finds 156 differing table-section records among the 89 common tables. Therefore
  #585 snapshots are not a valid base. Those 156 raw differences are evidence to regenerate and
  compare every schema field at final composition; they are not, by themselves, authority to
  copy train definitions.
- #608's provisional 0112 user-action vocabulary SQL differs from train 0112 SLA FKs. Keep the
  two units and their source owners separate. Final IDs follow the frozen dependency DAG.
- #569 provisional 0082 is distinct from accepted 0082 and cannot be inserted into accepted
  history. Treat its index as a later candidate semantic unit only if its owning code is selected.
- #591 `0118_magenta_speed.sql` and train `0118_fair_kabuki.sql` have different raw hashes but
  the same 12 ordered statements after replacing Drizzle breakpoint separators with statement
  boundaries and normalizing whitespace. Preserve provenance and replay the operation once.
- Snapshot fieldwise check compares each common table's columns, indexes, FKs, primary/unique
  constraints, checks, policies and RLS metadata. Final replay must additionally compare the
  selected owner's Drizzle `schema.ts` and migration schema to regenerated snapshots field by
  field. Snapshot table counts are only a completeness check, never proof of parity.

Private reproducible packet: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-09/final-migration-preparation/`.
`reconcile.py` consumes fetched Git refs, verifies the accepted-prefix hashes/journal,
provisional SQL/snapshot duplicates, collision identities and fieldwise #585 deltas, then writes
`reconciliation.json` (SHA-256 `639bc48b2789f8f343a4de5f9a7ef83783fe396d6389111291410a5b4cab567a`).
`python3 -m unittest -v` passed 5 offline checks. It requires no database, Docker, environment
mutation or credentials. The output is evidence for preparation only; it makes no selection or
allocation.

## Replay recipe after P0 acceptance

1. Refresh accepted `main`, P0 acceptance and each source owner's live PR head/base. Stop if the
   accepted P0 base or owner head differs from the captured source; recapture hashes.
2. Build an inclusion manifest with exactly one canonical owner source per semantic unit,
   explicit `include`/`exclude` reason, source SHA, SQL SHA, dependent units and authoritative
   feature contract. Do not guess at units still marked hold.
3. Parse SQL by Drizzle statement-breakpoint boundaries. Group byte-identical SQL by SHA-256;
   compare known non-byte-identical variants only through deterministic ordered-statement
   normalization. Reject any same provisional tag with distinct bodies unless represented as
   two distinct units with dependencies.
4. Construct the dependency graph from owner specs and actual CREATE/ALTER/FK references.
   Check for cycles and missing prerequisites. Stable-topologically-sort by the frozen feature
   dependency order, with SQL SHA as deterministic tie-break only among independent units.
   Freeze this result before allocating one contiguous final range from 0088.
5. Replay the selected SQL into a scratch source schema in that order. Generate each Drizzle
   snapshot from the immediately preceding selected schema and regenerate `_journal.json` from
   selected files. Never copy #585 snapshots or graft the cumulative 0118 snapshot.
6. Compare generated schema, snapshots and journal field-by-field against the final selected
   runtime schema. Assert accepted 0000–0087 file hashes and journal entries remain identical;
   assert no repeated semantic SQL, gaps, duplicate tags/idx, missing snapshot or journal/file
   mismatch. Save a source-owner → semantic-unit → final-ID crosswalk and machine-readable
   hashes.
7. Only after the root releases the shared resource window, run empty/fresh replay and upgrade
   from accepted 0087 with existing-data fixtures, then owning integration regressions and the
   source-bound image/SIT gates. These runtime steps are not authorized or performed by this
   preparation task.

## Explicit holds and unresolved contract decisions

- #602 P0 is blocked; final composition/replay waits for P0 acceptance.
- #598 0096 mixes request/intake objects and shared schema; split object ownership before
  including anything.
- #513 SLA owner for 0088 and exact migration lineage must be refreshed; its current branch base
  is not accepted `main`.
- Thomas approved #608's legacy pending-action DTO behavior on 2026-10-09: emit canonical
  `delete`/`user`, resolve legacy `person` to `user`, preserve the stored row/hash/proofs and
  legacy approval refusal, and fail closed for unresolved targets. The decision unblocks the
  named implementation path only; spec/source/regression work, exact-head review/checks, owner
  acceptance and central migration selection/replay remain pending. Keep #608 0112 distinct from
  train 0112 SLA SQL; do not guess, reuse a tag/idx, or merge incompatible SQL.
- #585 stale snapshot definitions require regenerated snapshots and full runtime-schema
  fieldwise reconciliation.
- #591 saved-view ownership is identified, but the complete current owner source/URL contract
  and shared-key identity owner must be reconciled at composition.
- Hold 0098 custom fields, 0092 without a proven owner, 0103 pending exact search owner,
  0117 plugin configuration, and any other schema-only or future capability. No new
  table/event/capability is authorized by this ledger.
