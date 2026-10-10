# Migration ledger

The conductor-owned record of Drizzle migration allocation. It is evidence and allocation
state, never new authority (see [AGENTS.md](../../AGENTS.md#authority)). Forward-only: an
applied migration is never edited, renumbered or removed.

Migration directory `apps/api/drizzle/`; journal `apps/api/drizzle/meta/_journal.json`;
runner is the stock `drizzle-orm/node-postgres/migrator`, which runs a unit only when its
journal `when` is greater than the newest `created_at` already applied, so `when` must be
strictly increasing. The recorded hash is the SHA-256 of the exact `.sql` bytes.

## Ranges

| Range | Source | State |
| --- | --- | --- |
| 0000-0087 | accepted `main` (journal max `when` 1791107747302 at idx 87, `0087_romantic_sway`) | applied, frozen |
| 0088-0118 | M1 post-P0 migration spine (this change) | landed by M1 |
| 0119 | N2 tenant-composite foreign keys (forward-only) | allocated, see below |
| 0120+ | unallocated | next allocation below |

## 0088-0118 (M1)

Journal and snapshot lineage: PR #589 head `2350397b18f83ed417bf63d73970daacdbaae49c`
(conductor decision: adopt #589's lineage for the full 0088-0118 chain). The SQL of every
unit is byte-identical to the train (#585 for 0088-0115, #594/#595/#596/#586 for 0116-0117,
#589/#598 for 0118); the ledger draft's git blob and SHA-256 prefixes were all confirmed. The
journal is #589's idx 88-118 appended to main's idx 0-87 unchanged; snapshots
`0088_snapshot.json`-`0118_snapshot.json` are #589's, taken as one lineage and never mixed
with #585's lineage (which lacks 0100-0109 snapshots).

| idx | tag | journal `when` | SQL SHA-256 | source PR provenance |
| --- | --- | --- | --- | --- |
| 88 | `0088_parallel_hairball` | 1791107748302 | `355060f6ad6eecc698f8da183da191502cc245e05f1ece02aa2230553d2e73e0` | #585 (train spine) |
| 89 | `0089_p2_sla_version_pinning` | 1791107749302 | `308012d2d364adf45808f9908a0956c97fa31475315728a73441562880b80197` | #585 (train spine) |
| 90 | `0090_unique_the_stranger` | 1791107750302 | `0f3dfc7d3e17b837c984fdb255b1eabc93ff1be1da5a55588090e142a6e5d2b4` | #585 (train spine) |
| 91 | `0091_whole_mojo` | 1791107751302 | `077012bc477e03f79c1795dddfeb29dd2a8430864550654f8780c3afd183de16` | #585 (train spine) |
| 92 | `0092_bright_prowler` | 1791107752302 | `7acd9005efcfb7048c9e3efcacbf4b6d04499719a3a8778a90bda82fe2c644fe` | #585 (train spine) |
| 93 | `0093_mature_exodus` | 1791107753302 | `50acbb4773658fd847f4c6684bdd9a87e150557c15498c56d5d3c02fc2dcc0b0` | #585 (train spine) |
| 94 | `0094_violet_living_lightning` | 1791107754302 | `147bf48dafe118c230cb71dab8055a0c163d5ed8394f03c4ba22c9a44e018c9e` | #585 (train spine) |
| 95 | `0095_p3_scim_directory_profile` | 1791107755302 | `4aeb725063b0d04b448a42f596877784b1ab44b0420b4dbb005eaaffa5ae8ea4` | #585 (train spine) |
| 96 | `0096_normal_whizzer` | 1791107756302 | `d5fbedf6d4456f4135d401f41c347f2c1de9f2344884b74616e393735d8f23ce` | #585 (train spine) |
| 97 | `0097_red_corsair` | 1791107757302 | `fb127f288854c8a466062cc1325b81e47aae6bce739cf9daa61303121d7eeed4` | #585 (train spine) |
| 98 | `0098_custom_fields_runtime` | 1791107758302 | `cffbdc3e691730152bad23171e8fb1f7a64f6610f8cd29a3e7e1f16f9fd222ff` | #585 (train spine) |
| 99 | `0099_submission_draft_staging` | 1791107759302 | `c233232e34e407616db2e27f13a17c5f858fb4a70e17e8b5378c062f24f73fa0` | #585 (train spine) |
| 100 | `0100_request_type_version_auto_accept` | 1791107760302 | `d9170707a738e0e539b03f3e8dd87869c8a3533c46c5fa38c1e069e682b9c48d` | #585 (train spine) |
| 101 | `0101_dear_crystal` | 1791107761302 | `3af31b1044701713745c403c96393f0533fa2ebe1e9a47f90e57e9149b0f34cf` | #585 (train spine) |
| 102 | `0102_productive_hawkeye` | 1791107762302 | `0229167d3a5afc49bbd520d73256fd24c4b3e537d8f69c332193ab822cac7ec6` | #585 (train spine) |
| 103 | `0103_work_item_title_trigram_index` | 1791107763302 | `cda71bcd6279ca87eeffad47fe121cc4a5ad43f65b73c387a6c729bcfccfd25a` | #585 (train spine) |
| 104 | `0104_moaning_marvex` | 1791107764302 | `caf1a885a0effac26c382a85b0ae08ccb632c34f92e71ff31278b0e9e349d88d` | #585 (train spine) |
| 105 | `0105_p3_scim_match_attributes` | 1791107765302 | `7aeb45b96537de0e4f41090077263625a505572ae7bb093a385f8628ca7695b9` | #585 (train spine) |
| 106 | `0106_absent_plazm` | 1791107766302 | `d981e24561f7933a56ec2d22d642a415c1e28e850248dcd26af8f04ee3acc572` | #585 (train spine) |
| 107 | `0107_equal_rockslide` | 1791107767302 | `2f470071393165ee4f987cdd5bf2d67e0ac2bea1dcf3abe8f198114c586037be` | #585 (train spine) |
| 108 | `0108_instance_admin_grant` | 1791107768302 | `16928d024a1791c6e34e6af6027624e9c6b9259dc2231262bdebf4b6098ba160` | #585 (train spine) |
| 109 | `0109_user_deactivation_pending_action` | 1791107769302 | `05e18a54b2476f29c4940f582ff053e53f5626ec4d82cd0c778cd4ac9af47529` | #585 (train spine) |
| 110 | `0110_instance_scoped_outbox_events` | 1791107770302 | `03549709f5955dd82b97fe69a2fd3fa2fd3bec343be9135cf9c3f9458418b86b` | #585 (train spine) |
| 111 | `0111_instance_scope_must_be_empty` | 1791176122469 | `28f96c060e5b14da71ca1f62eedb38664f75597b8870742f59147da5996702a4` | #585 (train spine) |
| 112 | `0112_sla_policy_workspace_fks` | 1791201121658 | `82ec0a4fc1ce7a84c0fc7d0a58f654d6ef129e6007aaf705aab8006769f8c73a` | #585 (train spine) |
| 113 | `0113_project_managed_service_calendar` | 1791215194650 | `374807a9b020b7db9e43ab2ce346a6e234f655a70f88a2a723e7a86da51c783a` | #585 (train spine) |
| 114 | `0114_groovy_madame_hydra` | 1791270497858 | `b14ca71867554d7c5b58e75524715c8d89385ecf03c4f4d07a80852d6fa59fea` | #585 (train spine) |
| 115 | `0115_tidy_nekra` | 1791270547590 | `dee9faa8e4bedf4b03a7dff326c11c7a74140c8c46da2b6ea1c9a040b78a742a` | #585 (train spine) |
| 116 | `0116_approvals_lifecycle` | 1791270548590 | `455f0f3cf2de9c17ba5f490c2836f6d912d82278358240b06662dc57da1bb958` | #594/#595/#596/#586/#589 (identical) |
| 117 | `0117_instance_plugin_config` | 1791287362449 | `abdf5e53f720fcf00260f97563dc31c992df4c14df1a4fe552e179291ad9d26f` | #594/#595/#596/#586/#589 (identical) |
| 118 | `0118_fair_kabuki` | 1791344327180 | `b436272134357b6b5b7eb0a86352808b52f03244582abcbbb567b78fc8cb0134` | #589/#598 group |

`when` is strictly increasing from 1791107747302 (idx 87) to 1791344327180 (idx 118).

Schema source: `apps/api/src/database/schema.ts` and `apps/api/src/permissions/shadow-schema.ts`
are #589's versions, `apps/api/src/database/migration-schema.ts` is new from #589, and
`apps/api/drizzle.config.ts` lists all three schema files, so `drizzle-kit generate` reports
no schema changes and `drizzle-kit check` passes at idx 118. No route, service or runtime
relation code is included.

Evidence (worktree `claude/m1-migration-spine`, `apps/api`): `DATABASE_URL=postgres://u:p@localhost:1/x
pnpm exec drizzle-kit generate --name probe` printed `No schema changes, nothing to migrate`, and
`pnpm exec drizzle-kit check` printed `Everything's fine`. The 0118 snapshot was introspected from
a live database, so check and partial-index expressions in `schema.ts` and `shadow-schema.ts` are
written as `sql.raw` strings in Postgres-normalised form to match it. Existing column
declarations were corrected only where the applied migrations say so:

| Declaration | Correction | Justified by |
| --- | --- | --- |
| `apikey.referenceId` | nullable, no foreign key | `0013_quiet_gladiator.sql` adds `reference_id text` with neither; no migration adds them |
| `label.workspaceId` | NOT NULL | `0005_jittery_monster_badoon.sql` `SET NOT NULL` |
| `outbox.workspaceId` | nullable | `0110_instance_scoped_outbox_events.sql` |
| `membership` index | `uniqueIndex("membership_person_scope_scope_id_unique")` replaces the plain index | `0093_mature_exodus.sql` |
| `attachment.commentId`, `submissionId` | foreign keys added; `submissionFieldKey` added | `0096_normal_whizzer.sql`, `0102_productive_hawkeye.sql` |
| `workspace` | `deletedAt`, `purgeAfter`, `defaultSlaPolicyId` added; declaration moved below `twoFactorTable` | `0089_p2_sla_version_pinning.sql` (`default_sla_policy_id`), `0092_bright_prowler.sql` (`deleted_at`, `purge_after`), `0112_sla_policy_workspace_fks.sql` (composite FK) |
| `organisation_quota.maxStorageBytes` default | `sql.raw("21474836480")` | serialization form only |

`user.emailVerified` gained `.default(false)` (the database default exists since 0003 and is in the
snapshot); the insert type is unchanged, since the app-side `$defaultFn` remains. Three comment
blocks (about 16 lines) were rewritten by #589 because the migrations above make them false: the
"`sla_policy` does not exist yet" note on `work_item_type`, the "deliberately NOT added" trigram
index and `search_vector` note on `work_item` (0103 creates the trigram index), and the "comment and
submission foreign keys not wired" note on `attachment` (0096 adds them). The stale
`scim_group_member` comment on `membership.derivedFrom` and the `attachment/policy.ts` header were
corrected in this change; every other existing comment is kept.

## Exclusions

| Excluded | Reason |
| --- | --- |
| #608 `0112_users_pending_action_canonical_vocabulary` | net no-op against 0109 and collides at idx 112 with the train's `0112_sla_policy_workspace_fks` |
| #611 `0102_sla_pause_PROVISIONAL` | conflicting second `CREATE TABLE "sla_pause"`; superseded by D3 |
| #513 / #611 numbering 0087-0101 | the same SQL as the train's 0088-0102, shifted by one; collides with accepted `0087_romantic_sway`; their `when` values sit below main's max and would be silently skipped |
| #569 renumbering (0080-0082) | collides with accepted 0080-0082; two of its three units already exist on main as 0082/0083; its `pending_action_expiry_indexes` is not part of M1 and needs a fresh unit if wanted |
| #512, #506 trees | stale older-main trees with no migration units of their own |

## Decisions applied

- **D3 (Thomas):** `sla_pause` uses the train's `0104_moaning_marvex` shape (composite primary
  key `work_item_id, metric, started_at`; CHECKs on metric, reason and end-after-start; FK
  `ON DELETE cascade ON UPDATE cascade`; one-open-per-metric partial unique index), not #611's
  provisional 0102.
- **D5 (Thomas):** #598's `intake/*` is canonical; #513's request-type/feature-flag runtime is
  held. The feature-flag and request-type tables are in the byte-identical 0088-0118 spine and
  are kept; M1 adds no runtime code for them.
- **Lineage (conductor):** #589's journal and snapshots for 0088-0118.

D3 and D5 are recorded in [decision-log.md](decision-log.md), entry "2026-10-10 - Owner integration
decisions for the post-P0 consolidation" (items D3 and D5).

## 0119 (N2 tenant-composite foreign keys)

| idx | tag | journal `when` | SQL SHA-256 |
| --- | --- | --- | --- |
| 119 | `0119_tenant_composite_fks` | 1791609109777 | `7ce96b3bea45e477f10bc346158cd191e8d27fb306198a9a551fc3056e1c110b` |

Generated with `drizzle-kit generate` from the `schema.ts` change; the statements are reordered by
hand so the parent UNIQUE constraints precede the foreign keys that need them (the generated order
failed). Snapshot `0119_snapshot.json` chains from 0118; `drizzle-kit generate` then reports no
changes and `drizzle-kit check` passes. The data-validity preflight is in the operations runbook,
[Upgrading across migration 0119](../05-operations/runbook.md#upgrading-across-migration-0119-cross-tenant-rows).
Negative tests: `tests/api-integration/tenant-composite-fks-migration.test.ts`.

## Security review N2: disposition

Security review N2 (tables new in 0088-0118 lacking tenant-composite foreign keys, the
`(workspace_id, id)` convention of `data-model.md`). 0119 does not invent columns, so a reference
is only made composite where the child already carries `workspace_id`.

| Reference | Status | Reason |
| --- | --- | --- |
| `0118` `saved_view.shared_with_team_id` | **Done in 0119** | `saved_view.workspace_id` exists. New FK `saved_view_workspace_shared_team_fk` `(workspace_id, shared_with_team_id)` to `team (workspace_id, id)`, plus parent `team_workspace_id_id_unique`. ON DELETE/UPDATE no action (the replaced single-column FK was ON UPDATE cascade, now no action), so a direct team delete stays refused and a workspace delete still cascades. |
| `0114` `notification_delivery` to its outbox event | **Done in 0119** | `notification_delivery.workspace_id` exists. New FK `notification_delivery_workspace_event_fk` `(event_id, workspace_id)` to `outbox (event_id, workspace_id)` replaces the single-column event FK (ON DELETE cascade kept; ON UPDATE changed from cascade to no action), plus parent `outbox_event_id_workspace_id_unique`. A NULL-workspace instance event can never back a delivery. |
| `0098:64` `custom_field_type_visibility.work_item_type_id` | **Not applicable here** | The table has no `workspace_id` (columns: `custom_field_id`, `work_item_type_id`, `visible`, `required`). Anchoring needs a new column, which 0119 does not invent. Follow-up when the custom-fields runtime lands: add `workspace_id` with composite FKs to both `custom_field` and `work_item_type`, or record a waiver. Still open and gated "before any runtime slice writes the table". |
| `0098:66` `custom_field_value.project_id` | **Not applicable here** | No `workspace_id` on the table and `project_id` is nullable. `entity_id` has no FK; today its CHECK restricts `entity_type` to `'work_item'`, so a work-item FK could be added once `workspace_id` exists. Same follow-up as above. Still open. |
| `0116:23-24` `approval.work_item_id` / `transition_id` | **Not applicable here** | `approval` has no `workspace_id`. Same follow-up: add `workspace_id` with composite FKs to `work_item` and `workflow_transition` (each needs a `(workspace_id, id)` parent key) before the approvals runtime. Still open. |
| `0090` `membership_grant`, `oidc_group_mapping`, `scim_group_mapping` `role_id` / `scope_id` | **Not applicable** | `scope_id` is polymorphic (`scope` is `organisation` or `workspace`, no per-table workspace column) and `role.workspace_id` is nullable by scope, so no FK can express "role belongs to the scope's workspace". It is the same shape as `membership`: the resolver's `wellAnchored` filter must hold wherever these produce memberships. Recorded residual, not a waiver of the filter. |

**Forward design constraint (notifications runtime).** Instance-scoped events
(`pending_action.*`, `identity.deprovisioned`) have a NULL `outbox.workspace_id` and, after 0119,
can never back a `notification_delivery` row. The notifications runtime must not fan those events
out through `notification_delivery`, and must not make `notification_delivery.workspace_id`
nullable to get around it; they need a separate delivery path. Deleting a `notification_delivery`
row also cascades to `outbox_dedupe_reservation` (0114).

## Open forward items after 0119

Still open, each needing a forward-only migration (or a decision-log waiver) and a negative test
**before any runtime slice writes the table**: the three "Not applicable here" rows above
(`custom_field_type_visibility`, `custom_field_value`, `approval`). `tests/api/database/unanchored-tables-unreferenced.test.ts` fails if any file under `apps/api/src` other than the schema declarations references them, until they are anchored. They need new `workspace_id`
columns, so they are a design change rather than a constraint-only change.

## Notes for future allocation

- Migration `0093_mature_exodus` drops the non-unique `membership_personId_scope_scopeId_idx`
  and creates the UNIQUE index `membership_person_scope_scope_id_unique` on
  `(person_id, scope, scope_id)`. It fails on a database that holds duplicate
  `(person_id, scope, scope_id)` rows. Preflight on every target database before applying:
  `select person_id, scope, scope_id, count(*) from membership group by 1,2,3 having count(*) > 1;`
  must return no rows. The upgrade aborts as a whole, atomically, if duplicates exist, and the API
  runs migrations at startup. The preflight and the remediation procedure (which row to keep) are
  in the operations runbook (which also carries the required `max(created_at) = 1791107747302`
  applied-history check before any upgrade to 0088+), [Upgrading across migration 0093](../05-operations/runbook.md#upgrading-across-migration-0093-duplicate-membership-rows).
- Legacy rows are not backfilled for the new columns. Existing `notification` rows get NULL
  `person_id`, `kind` and `body` from 0114, and existing `outbox` rows get migration-time
  `created_at`/`updated_at` from 0115. The notification runtime PR must handle both (skip or
  backfill); M1 adds no runtime code, so this is inert until then.
- Hand-written migrations 0006, 0014, 0016, 0020, 0024, 0025, 0043, 0050, 0051, 0071 have no
  snapshot; that is inherited and expected.

## Next allocation

Next index is **0120**. Its journal `when` must be strictly greater than **1791609109777**
(idx 119) and than any `when` any environment may already have applied. Generate it with
`drizzle-kit generate` so its snapshot chains from `0119_snapshot.json`. The conductor
allocates each index to exactly one owner.
