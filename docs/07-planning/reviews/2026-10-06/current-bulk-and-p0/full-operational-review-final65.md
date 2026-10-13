# Independent GPT-6 Sol operational and security review — private final65

**Verdict: BLOCK.** The exact frozen private runner cannot be released for another actual proof run on this review. One evidence integrity defect remains in the newly centralized receipt path. This is a source and offline review, not runtime acceptance, stage completion, or authority for Config, Task, G11, date carry, deployment, merge, or a finalizer.

## Independence and exact bytes

I independently reviewed the current private release. I did not author, direct, or remediate final65, and did not edit its controlled source or the product. The candidate product source remains `08842235047a3ab2714427edce80331b94558150`. The frozen release path is `/Users/heinthura/.codex/taskdesk-evidence/2026-10-06/p0-strict-cutover-prep/releases/strict-shadow-separated-draft`.

| Artifact | Verified SHA-256 |
| --- | --- |
| `draft-manifest.json` | `818209d9befc8428483c34cb0b49f495d84b17dc85c555eaeb445de5050ed4f5` |
| `release-packet.md` | `a640dc6f7dc0f786b8e087e05c50b78ebbef8da73c95c6edbbefb4d0ed57bd85` |
| `structural-refreeze-audit.json` | `4b1dd4b5596cfe5defdeb3990047079a7e0da6b0f568e08a64b56385cc0e3ef6` |
| `offline-tests.log` | `e86b420a009d338d9f4247bcc3fc42b800f2342a0b3ee566f72ceef8669ba03a` |
| `run-strict-cutover-prepared.py` | `33b163b657a950c80219b4fa5ee177d3e96390ee9e554a3a3ab4017564590d5d` |
| `proof_helpers.py` | `7fd7c4a31e18b7847e703cf7c4802e6a9979437babae8d95289bfbea93078564` |
| `run-verified-strict-cutover.sh` | `5c027bb18a20ae9024f79bddae139c78d6e37fb9c6fbafd439a374540234a382` |
| `test_strict_cutover.py` | `3e6ea29af6aac6fdb52ad0b785ac8005b5902eb3131a6a74e5a8d5d80a4c288b` |
| `prepared-plan.json` | `3c7a2c6a16d1c29a3307fcb21a91e6ade62fe0c9c0fb54d337466fc8a4f1da12` |
| `strict-stages.json` | `c15aed44e31c38f3aae1190a074309a16dcb1d8aecea7bdf743b6043c574a591` |
| `strict_cutover.py` | `b7a2115502179f85cf7f575bfdca62c5d6f9b4bb6832f902f5ccd8872d432ead` |

The manifest's audit hash is `4b1dd4...`; `852a60...` belongs to the historical final61 audit and must not be used to pin final65. The immediately preceding 12-file immutable snapshot manifest is `b2e2f7592c74aac9d95fbac8cacf38d9bb34b647e383e9281616f3b7ec2efb48`. I compared its controlled Python and launcher changes with current final65. The release's own log reports 65 tests, Python compilation, and trusted launcher help passing. I independently ran the pure Python suite: **65 tests passed**, including the 10 ordering/mismatch tests. I also exercised the pure status builder and aggregate binder with observed `400`, `409`, `422`, and `500` against expected `404`; each remained a mismatch and aggregate-invalid. No Docker, SQL, browser, performance, credential, or actual runtime operation was run.

## Blocking finding

**[P1] The successful hostile PATCH proof persists a false side-effect receipt.** In `run-strict-cutover-prepared.py:1556-1573`, `record_planned_request` copies a row into `safe_row` before appending and writing traffic progress. At lines 1869-1876 the nonmember PATCH initializes `mutation_row['side_effect_free']=False`, passes it to that recorder, then computes digest equality and sets `mutation_row['side_effect_free']=True` after the write. The persisted `safe_row` remains `False` even when the digest proof succeeds. The subsequent `persist_traffic_progress()` rewrites the same copied row, and the final traffic payload uses it. The ledger in `proof_helpers.py:2031-2033` checks that this marker is a boolean but does not require it to agree with the successful mutation-safety proof. A run can therefore pass its exact status and later acceptance gates while its retained traffic evidence asserts that the denied mutation was **not** side-effect-free. This contradicts the intended security proof and makes the success receipt untrustworthy. The new tests do not cover the actual appender → later digest update → persisted receipt path.

The fix should persist the observed digest result in the same traffic row before acceptance, with a fail-closed path for missing or failed digest verification. It must retain the exact `404` expectation and the immediate safety failure on mutation or missing digest. Review the next exact bytes independently before a runtime release.

## Operational path and residuals

The primary final65 correction otherwise preserves the expected-status contract. `execute_fixture_actor_route_plan` records each base-plan response before testing its status; the supplemental custom-role, plain-member, limited-role, and nonmember reads use `observe_expected_status` and retain finite actual/expected codes. The `record_planned_request` guard accepts observed `0..599`, so `400`, `409`, `422`, or `500` do not themselves truncate the safely executable read sequence. A mismatch persists a bounded response-shape diagnostic, and a mismatch diagnostic write error fails closed. `bind_traffic_status_expectations` rejects mismatches and incomplete pair coverage before the strict window is entered. Structural fixture, invalid response, ownership, and unsafe mutation failures remain immediate. The launcher pins the current runner, helpers, stages and test bytes; resource acquisition, run ownership, volume persistence across API restarts, rollback, exact cleanup, root release authority, stage binding, event/tally reconciliation, and result gating were inspected against the preceding immutable revision and were not weakened by this delta.

There is a separate reporting limitation: the new aggregate `safe_failure_detail` contains mismatch tuples in memory, but `safe_failure_record` has no allowlisted detail schema for the `shadow_event_reconciliation` stage where the aggregate gate runs. Thus `failure.json` will reduce `safe_detail` to `null`; the separately persisted mismatch diagnostic and traffic-progress files remain the finite evidence. The packet's claim that the final failure detail includes those tuples is too broad. This is nonblocking relative to the more serious contradictory success receipt, but the packet or schema should be corrected with the next frozen batch.

Actual final61 run `20261006T140030Z-08842235` remains failed after 102 persisted rows; its next nonmember column response was never retained and remains unknown. Its 9/9 cleanup receipt proves only cleanup. The source/spec `400` versus `404` column masking conflict remains unresolved and is not changed by this runner review. All older failed runs and stale review/release records remain historical. Final65 has no actual runtime proof or phase acceptance. The root issuer must hold any runtime release until this blocker is corrected and a fresh exact-byte independent Sol review clears it.
