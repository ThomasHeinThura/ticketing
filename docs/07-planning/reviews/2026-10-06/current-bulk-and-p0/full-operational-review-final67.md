# Independent GPT-6 Sol operational and security review — private final67

**Verdict: BLOCK.** The PATCH owned-row repair closes the final65 contradictory-success-receipt finding, but the new safe-row validator can reject a valid bounded diagnostic before recording an unexpected HTTP response. This defeats final67's stated full-window capture behavior. No actual runtime, stage, date, Config, Task, G11, deployment, merge, or finalizer acceptance follows from this review.

## Independence and byte identity

I did not author, direct, or remediate final67. I inspected the current private release at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-06/p0-strict-cutover-prep/releases/strict-shadow-separated-draft`, compared its controlled source with the immutable 12-file final65 snapshot (manifest SHA-256 `b63444b5c4d8ccfa8e9ab69f483322af60da2b875610d3ef115b493de800ef1a`), and did not edit product or release source. Candidate product source remains `08842235047a3ab2714427edce80331b94558150`.

| Current artifact | Verified SHA-256 |
| --- | --- |
| `draft-manifest.json` | `d1b8a938acb6c7c509470ad27ea07690ef03a3ddb83fbcbd5d72ec535823b200` |
| `release-packet.md` | `a7318150dd5aa1d7360ac23d7032eb7b1ac0b7423556ab0eefa40ceec6082dae` |
| `structural-refreeze-audit.json` | `f78e52e466dff0457ad155cac0eab9ecf5346293d173bf1091c2474cf8e39665` |
| `offline-tests.log` | `f4208b44a55b3302cb7f85e17823d1f5e71f2b51c248b7a55ef28ef403033915` |
| `run-strict-cutover-prepared.py` | `42c56fccdad41bc4169b86742131c4168034ace08b1e6d022dbf5fe1f2084923` |
| `proof_helpers.py` | `ad14f343097ba9e68ff1f7222d612133136bcb2e4b07e2c049471e2b0c97de54` |
| `run-verified-strict-cutover.sh` | `1a44939a5ef6db636d7151ee960e1d24a4775344260bdbec497bf3cfd259fec5` |
| `test_strict_cutover.py` | `dba107ac0be0ae66f22310ea46d3ad5bbbf2bfc49b516871fa138d837affc614` |
| `prepared-plan.json` | `3c7a2c6a16d1c29a3307fcb21a91e6ade62fe0c9c0fb54d337466fc8a4f1da12` |
| `strict-stages.json` | `c15aed44e31c38f3aae1190a074309a16dcb1d8aecea7bdf743b6043c574a591` |
| `strict_cutover.py` | `b7a2115502179f85cf7f575bfdca62c5d6f9b4bb6832f902f5ccd8872d432ead` |

The author log records 67/67 pure tests, Python compilation, and trusted launcher help passing. I independently ran the full pure suite: **67/67 passed**. I also reproduced the blocking producer-to-appender case below using the controlled helper in memory. No actual runner, Docker, SQL, browser, performance resource, network service, or credentials were used.

## Blocking finding

**[P1] The diagnostic producer and centralized safe-row validator disagree on an entire valid output class.** `safe_response_diagnostic` deliberately reports the actual scalar `body_bytes` and labels responses above 16,384 bytes `invalid_or_oversize`; that size limit bounds content inspection, not the scalar count. The new `_validate_safe_traffic_row` instead requires `body_bytes <= 16384`. `execute_fixture_actor_route_plan` attaches the producer's diagnostic to any status mismatch and calls the recorder before continuing. The recorder now calls `append_safe_traffic_row`, which rejects every oversized diagnostic. I reproduced an unexpected `500` with a 16,385-byte body followed by a safely executable next planned read: the executor raised `ValueError`, only the first request ran, and **zero traffic rows** were persisted. The same early stop applies to any unexpected `400`, `409`, or `422` with an oversized response body. The runner converts this into a fail-closed proof failure, so it cannot falsely accept the run, but it loses the actual status and does not finish the bounded 130-pair evidence window promised by this batch. The 67 tests cover small mismatch bodies and do not cover this producer/validator boundary.

I checked the producer's full output partition against the new validator using empty, object/message-class, array, JSON string, number, boolean, null, malformed JSON, binary, oversized JSON, and oversized binary bodies. All ordinary finite shapes passed. Both oversized cases produced the documented `invalid_or_oversize` shape and failed solely because their actual byte counts exceeded 16,384. The safe ledger strips `response_diagnostic` before normal traffic persistence and keeps only its bounded, classified fields in the separate mismatch receipt; no raw body is needed to fix the contract.

The next revision should reconcile the entire producer/validator contract, retaining a finite actual byte count and bounded classification without persisting raw response content. A regression should send oversized JSON and binary mismatch responses through the actual producer → appender → next safe request → aggregate rejection path. Exact planned statuses, mutation safety, and aggregate rejection must remain unchanged.

## Reviewed controls and remaining limits

The final65 PATCH finding is fixed in source: `append_safe_traffic_row` returns the exact ledger-owned dict; `finalize_work_item_mutation_witness` verifies before/after 32-hex digests, updates and persists that same owned object, and labels unchanged, changed, or unavailable outcomes. Identity and full-row checks reject non-owned or malformed updates. The nonmember PATCH remains expected `404`; changed or unavailable digests stop immediately; the final binder also requires both `side_effect_free is True` and the exact `work_item_digest_unchanged` witness. The new tests exercise unchanged, changed, missing, non-owned, invalid update, and status-mismatch cases. This prevents the previously contradictory successful receipt.

For ordinary finite mismatch bodies, the executor records observed/expected statuses before aggregate evaluation; the 0–599 observed status range remains unchanged, and the binder rejects mismatches and incomplete coverage before strict activation. The stage/mode binding, 27 selected eligible sources with Config/Task deferred, separate off-shadow and strict witnesses, source-bound tally/event reconciliation, strict 5xx rejection, asset-owner 200 and PNG persistence checks, API data volume across restart/rollback, exact resource ownership and cleanup, launcher hashes, and root release/result authority were inspected against the pre-edit snapshot and were not weakened in this delta. The packet now accurately says aggregate `failure.json.safe_detail` is null under the current allowlist and that status evidence lives in separate progress/mismatch files. Its final sentence refers to “final66 hashes” despite this being the final67 manifest; use the exact manifest above for any later release record.

Actual final61 run `20261006T140030Z-08842235` remains failed after 102 persisted rows; the following nonmember column status remains unknown. Its 9/9 cleanup is only cleanup evidence. The source/spec column `400` versus `404` masking conflict remains open. No new runtime result exists for final67, and all prior run and review records remain bound to their old bytes. A fresh exact-byte independent Sol review is required after this blocker is corrected; the root issuer must hold actual execution and release meanwhile.
