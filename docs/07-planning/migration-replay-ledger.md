# Central migration replay ledger

**Verified:** 2026-10-08 16:48 UTC. **Accepted base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`.
The accepted Drizzle history ends at **0087**. This ledger records candidate source identities
and owners; it does not allocate new migration IDs or change applied history.

## Invariants

1. Preserve accepted migrations **0000–0087 byte-for-byte and in their current journal order**.
2. After accepted P0, construct one dependency-ordered integration from accepted `main` and
   the selected feature owners. Do not merge #589 or #598 as whole trains.
3. Treat provisional IDs 0088–0118 as labels from historical candidate trees, not accepted
   allocation. Freeze the selected semantic-unit set and dependencies first, then allocate a
   single contiguous tail beginning at 0088.
4. Apply each semantic SQL unit once. Regenerate all selected Drizzle snapshots and the journal
   from the final composed schema. Re-review and test the exact composed source and migrations.
5. Do not apply provisional migrations to persistent DEV or any customer database. No final
   migration allocations or applied-prefix rewrites are authorized by this planning record.

## Provisional semantic units

SQL hashes are SHA-256 values from the private 2026-10-08 comparison manifest. They identify
historical candidate SQL; they are not final migration IDs or authorization to include a unit.
Except for the separately identified #608 vocabulary correction, the 31 SQL bodies below are
byte-identical in #589 and #598. Select inclusion from feature ownership, implementation,
contract and stage acceptance—not merely because a statement appears in a cumulative train.

| Provisional ID | Candidate SQL file | SQL SHA-256 | Owner / current disposition |
|---:|---|---|---|
| 0088 | `0088_parallel_hairball.sql` | `355060f6ad6eecc698f8da183da191502cc245e05f1ece02aa2230553d2e73e0` | P2 SLA policy/versioning foundation and service-calendar FK prerequisite; owner assignment remains across consolidated SLA source. |
| 0089 | `0089_p2_sla_version_pinning.sql` | `308012d2d364adf45808f9908a0956c97fa31475315728a73441562880b80197` | P2 SLA policy pinning; include only with its actual owner and implementation. |
| 0090 | `0090_unique_the_stranger.sql` | `0f3dfc7d3e17b837c984fdb255b1eabc93ff1be1da5a55588090e142a6e5d2b4` | P3 identity foundation; dependency for mapping and validated-login reconciliation. |
| 0091 | `0091_whole_mojo.sql` | `077012bc477e03f79c1795dddfeb29dd2a8430864550654f8780c3afd183de16` | P3 grant provenance and SCIM token invariants; pair with identity implementation. |
| 0092 | `0092_bright_prowler.sql` | `7acd9005efcfb7048c9e3efcacbf4b6d04499719a3a8778a90bda82fe2c644fe` | P4 workspace lifecycle and step-up route registry; permission/spec owner required. |
| 0093 | `0093_mature_exodus.sql` | `50acbb4773658fd847f4c6684bdd9a87e150557c15498c56d5d3c02fc2dcc0b0` | P3 membership uniqueness; pair with accepted identity/membership semantics. |
| 0094 | `0094_violet_living_lightning.sql` | `147bf48dafe118c230cb71dab8055a0c163d5ed8394f03c4ba22c9a44e018c9e` | P3 step-up route registry for identity administration; owner/security review required. |
| 0095 | `0095_p3_scim_directory_profile.sql` | `4aeb725063b0d04b448a42f596877784b1ab44b0420b4dbb005eaaffa5ae8ea4` | P3 SCIM group directory profile; identity/SCIM owner. |
| 0096 | `0096_normal_whizzer.sql` | `d5fbedf6d4456f4135d401f41c347f2c1de9f2344884b74616e393735d8f23ce` | P2 catalogue/intake owns only its request objects; reconcile shared feature-flag/schema objects against their real owners. |
| 0097 | `0097_red_corsair.sql` | `fb127f288854c8a466062cc1325b81e47aae6bce739cf9daa61303121d7eeed4` | P3 customer identity default-workspace restriction; identity contract owner. |
| 0098 | `0098_custom_fields_runtime.sql` | `cffbdc3e691730152bad23171e8fb1f7a64f6610f8cd29a3e7e1f16f9fd222ff` | **HOLD / exclude.** Four schema tables only; no complete runtime/API/permissions/UI/URL/test owner was found. Later snapshots containing the tables do not prove a capability. |
| 0099 | `0099_submission_draft_staging.sql` | `c233232e34e407616db2e27f13a17c5f858fb4a70e17e8b5378c062f24f73fa0` | P2 intake draft staging and backfill; catalogue/intake owner. |
| 0100 | `0100_request_type_version_auto_accept.sql` | `d9170707a738e0e539b03f3e8dd87869c8a3533c46c5fa38c1e069e682b9c48d` | P2 request-type auto-accept; catalogue owner. |
| 0101 | `0101_dear_crystal.sql` | `3af31b1044701713745c403c96393f0533fa2ebe1e9a47f90e57e9149b0f34cf` | P2 submission numbering; intake owner. |
| 0102 | `0102_productive_hawkeye.sql` | `0229167d3a5afc49bbd520d73256fd24c4b3e537d8f69c332193ab822cac7ec6` | P2 staged request attachment field key; intake owner. |
| 0103 | `0103_work_item_title_trigram_index.sql` | `cda71bcd6279ca87eeffad47fe121cc4a5ad43f65b73c387a6c729bcfccfd25a` | P1 search/work-item owner; include only with integrated implementation and supported schema generation. |
| 0104 | `0104_moaning_marvex.sql` | `caf1a885a0effac26c382a85b0ae08ccb632c34f92e71ff31278b0e9e349d88d` | P2 SLA pause records; SLA behavior owner, not intake merely because of train membership. |
| 0105 | `0105_p3_scim_match_attributes.sql` | `7aeb45b96537de0e4f41090077263625a505572ae7bb093a385f8628ca7695b9` | P3 SCIM matching attributes; identity/SCIM contract owner. |
| 0106 | `0106_absent_plazm.sql` | `d981e24561f7933a56ec2d22d642a415c1e28e850248dcd26af8f04ee3acc572` | P3 session connection link and step-up constraints; identity owner/security review. |
| 0107 | `0107_equal_rockslide.sql` | `2f470071393165ee4f987cdd5bf2d67e0ac2bea1dcf3abe8f198114c586037be` | P3 grant revocation reason; pair with validated-login reconciliation. |
| 0108 | `0108_instance_admin_grant.sql` | `16928d024a1791c6e34e6af6027624e9c6b9259dc2231262bdebf4b6098ba160` | P3 step-up route additions; include only with the exact policy contract. Identity assertions never grant instance admin. |
| 0109 | `0109_user_deactivation_pending_action.sql` | `05e18a54b2476f29c4940f582ff053e53f5626ec4d82cd0c778cd4ac9af47529` | P4 #608 pending-action vocabulary extension; compose with accepted canonical action/target contract. |
| 0110 | `0110_instance_scoped_outbox_events.sql` | `03549709f5955dd82b97fe69a2fd3fa2fd3bec343be9135cf9c3f9458418b86b` | P4 #608 instance-scoped outbox envelope; constrained by the approved event contract and tenant-event invariant. |
| 0111 | `0111_instance_scope_must_be_empty.sql` | `28f96c060e5b14da71ca1f62eedb38664f75597b8870742f59147da5996702a4` | P4 #608 empty-organization instance-scope constraint; depends on 0110 semantics. |
| 0112 | `0112_sla_policy_workspace_fks.sql` | `82ec0a4fc1ce7a84c0fc7d0a58f654d6ef129e6007aaf705aab8006769f8c73a` | P2 SLA composite workspace FKs in train; conflicts by provisional ID with #608's distinct user-action vocabulary migration. Allocate both only as distinct, dependency-ordered entries after inclusion freezes. |
| 0113 | `0113_project_managed_service_calendar.sql` | `374807a9b020b7db9e43ab2ce346a6e234f655a70f88a2a723e7a86da51c783a` | P2 #513 managed-service calendar fields; depends on service-calendar schema. |
| 0114 | `0114_groovy_madame_hydra.sql` | `b14ca71867554d7c5b58e75524715c8d89385ecf03c4f4d07a80852d6fa59fea` | P4 #585 notification delivery table/constraints; SQL duplicated in #589/#598, replay once. Use reconciled composed snapshots, never stale #585 89-table snapshots. |
| 0115 | `0115_tidy_nekra.sql` | `dee9faa8e4bedf4b03a7dff326c11c7a74140c8c46da2b6ea1c9a040b78a742a` | P4 #585 outbox timestamps; duplicate SQL, replay once with the owner implementation. |
| 0116 | `0116_approvals_lifecycle.sql` | `455f0f3cf2de9c17ba5f490c2836f6d912d82278358240b06662dc57da1bb958` | P2 #586 approval lifecycle; include only with exact-head implementation and accepted authority/pending-action behavior. |
| 0117 | `0117_instance_plugin_config.sql` | `abdf5e53f720fcf00260f97563dc31c992df4c14df1a4fe552e179291ad9d26f` | **Exclude under current feature freeze** unless an existing stage owner is proven and authorized. |
| 0118 | `0118_fair_kabuki.sql` | `b436272134357b6b5b7eb0a86352808b52f03244582abcbbb567b78fc8cb0134` | P1 saved-view/user-preference schema; integrate only with the complete existing saved-view implementation and URL/route contract. |

### Separate #608 migration with provisional tag 0112

The #608 source includes `0112_users_pending_action_canonical_vocabulary.sql`, a different SQL
body from train migration `0112_sla_policy_workspace_fks.sql`. It has no final sequence number
in this ledger. Preserve its source identity and verify its latest exact head before composing;
place it after the `user_deactivation` prerequisite only if that approved implementation
contract remains selected. Do not conflate the two files or assign either final numbering here.

## Duplicate and snapshot reconciliation

- The candidate SQL range 0088–0118 in #589 and #598 is byte-identical; replay a selected
  semantic unit once, not once per PR. The train SHA is a provisional schema/snapshot reference,
  never an owner or acceptance.
- #585 SQL 0114/0115 matches the train, but its two snapshots have 89 tables and omit tables
  present in the 96-table train snapshots. Rebuild snapshots from the selected final schema.
- #608's distinct provisional 0112 body collides by tag/idx with train 0112. Both may be
  included only after distinct final contiguous IDs are assigned in topological order.
- Saved-view owner migration and train migration have different raw hashes but the same twelve
  ordered SQL statements after breakpoint-boundary whitespace normalization. Retain one
  semantic operation in the final replay and preserve the source/evidence crosswalk.
- The #609 navigation/URL correction itself has no migration delta in the captured plan; do not
  infer that it owns saved-view schema solely from URL behavior.

## Source evidence

Private comparison inputs are recorded under
`~/.codex/taskdesk-evidence/2026-10-08/final-migration-replay-plan/`; the migration ownership
manifest SHA-256 is `7c15b3a5db313c0f7694075cfb06ef8fb9b0491d46a84c6d1f5f547f34770fff`.
The separate V20 runtime manifest SHA-256 is
`e51bf0cb343cddd922c426bf78784b22e400bc34c47780a753132c1a8eb554f2`. Its scoped Sol CLEAR
is limited to historical witnesses and does not admit actual strict runtime activation. Do
not copy credentials or private seeder data into repository files.

At replay time, refresh each owner PR and source hash, compare the actual SQL bodies, validate
dependencies against accepted schema and feature contracts, resolve duplicate semantic units,
then produce one migration/snapshot/journal candidate for independent review and required
integration acceptance.
