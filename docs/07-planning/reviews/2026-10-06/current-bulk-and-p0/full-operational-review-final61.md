# Independent GPT-6 Sol operational/security review — frozen private P0 runner final61

**Verdict: CLEAR for the frozen private runner at manifest SHA-256 `26e71e4884fbf37eaa16804f6b0469255a0bb79284fe7b5fa189f3adbbc765bc`.** The actual final59 fixture-diagnostic failure is corrected at the emitter while the helper's strict schema guard remains intact. I found no blocking regression in the reviewed acquisition, trust, traffic, failure, cleanup, and success paths. This exact-byte source verdict is not a runtime acceptance result.

**Independence.** Fresh independent full GPT-6 Sol review of the final61 delta, continuing the context that reviewed earlier private runner revisions. I did not author, direct, remediate, execute, or merge final61. I compared all controlled changes with the immutable final59 snapshot, verified the actual failed-run receipts, inspected the new emitter through persistence, and rechecked the complete operational/security path. Product source remains separately reviewed at `08842235047a3ab2714427edce80331b94558150`; accepted baseline source and image remain `b80ff7c3ef723a280bb35cfadec0a71b1ad14ae3` and `sha256:6a6315c2890b5677f9afb858c3f81aa86c181e7d3270fa7164d889111e214628`.

## Actual failure and source review

- Actual final59 run `20261006T133957Z-08842235` exited 1 with a durable `ValueError` at `proof_helpers.py:1044` during `representative_fixture_creation`. The old emitter passed `expected_status=200` to the custom `asset_bytes_round_trip_matches` category. The helper correctly permits expected status only for `http_status_matches`; it rejected that row before the asset byte-readback diagnostic could persist. The original failure and cleanup receipts remain unchanged. Cleanup passed 9/9 expected resources; that does not make the traffic run successful. This diagnosis applies to final59 and does not reconstruct the first fault of earlier runs.
- `make_asset_bytes_round_trip_diagnostic()` now computes its boolean from the **observed** HTTP 200, exact PNG bytes, unambiguous case-insensitive MIME field and exact content length. It passes `expected_status=None` for its custom category and records observed HTTP status separately. The helper's expected-status guard was not weakened. A 404, wrong body, wrong MIME or length yields `present: false` and the runner raises after recording the finite row.
- `record_fixture_diagnostic_row()` validates the entire constructed row against `validate_fixture_diagnostic_ledger()` before appending or persisting it. The new regression calls the actual helper and runner recorder, reads the private test ledger back, checks positive and failing rows, and confirms the old invalid expected-status combination still throws. A source scan found no other custom diagnostic emitter passing an expected status. The asset's object-key/metadata, persisted task/project/workspace, owner session and membership, shared `/app/data` volume, and post-restart owner 200 checks are unchanged.
- I rechecked the launcher and helper byte pins, candidate/source/image and delegated-release binding, 130-pair shared off/shadow and strict windows, known-status/selected-source/tally-event failure gates, renderer replay, finite failure-location/privacy path, API restart and rollback storage mount, exact owner/run-labeled volume and other Docker-resource cleanup, durable cleanup receipt, and `result.json` ordering. The code delta does not relax the required owner asset 200, the original PNG/body/MIME/length checks, or any release/cleanup condition. Config and task remain deferred.

**Residual proof limit:** the failed final59 run never persisted an asset readback row, so its actual asset HTTP status and body are unknown. The final61 revision needs a new, separately authorized exact-byte runtime run before any traffic or cutover acceptance claim. Earlier failed runs and their records remain historical failures.

## Exact bytes and checks

I recomputed SHA-256 for the manifest and all seven controlled inputs; each matched:

| File | SHA-256 |
| --- | --- |
| `prepared-plan.json` | `3c7a2c6a16d1c29a3307fcb21a91e6ade62fe0c9c0fb54d337466fc8a4f1da12` |
| `proof_helpers.py` | `be463e9084926fb2183dedeea32136c58feb2e3e0a4762cf1abf154be8f9865f` |
| `run-strict-cutover-prepared.py` | `d940c29db8156b6d7f85123731a6c0f7ea3d1d99a077f0b5964456fef522699b` |
| `run-verified-strict-cutover.sh` | `3576f37f9aae4532cf67b6c91ffb34d57923044d4fff33fa8aa034eef066a3bc` |
| `strict-stages.json` | `c15aed44e31c38f3aae1190a074309a16dcb1d8aecea7bdf743b6043c574a591` |
| `strict_cutover.py` | `b7a2115502179f85cf7f575bfdca62c5d6f9b4bb6832f902f5ccd8872d432ead` |
| `test_strict_cutover.py` | `6e9e3f7d30a7ee21f0597f611dfe12170d1392417327f95870f95c9bd12849c3` |

Release packet SHA-256: `8c807614c7910b88dcb10c0e9e765e805ab1dc92d8a53d30e799163062ccb5a0`. Structural audit: `852a60c6950310790bc86b03cdc61b4f1aba0169b5a20aa7d738da4a68184a2d`. Offline log: `20ac6bbb320be8cce3bef8c5a0d395240a60317c466aed25ca742c38bad4634f`; it records **61/61** tests, Python compilation and trusted launcher `--help` passed. I verified evidence hashes and inspected the actual new test and code paths; I did not rerun the suite or launcher under the no-runtime review constraint. The immutable final59 snapshot manifest hashes to `fda9f9ae1bad0242c7142500f7d5ef268da8ab4b4d431857f9abd34c50b944ab`, and all 12 listed files matched.

The failed final59 `failure.json` remains unchanged at SHA-256 `123886cc5aacdfcb8f7794506c8883068a65bab2176297e739f9fd81e99fe722`; its `cleanup.json` remains unchanged at `51f00c52246e820eed5ccfd657820656250de221832dc704bad0606a178d4b4c`. The prior final59 Sol report is stale for these executable bytes.

No candidate runtime, Docker, SQL, browser, credential, network or performance operation was performed in this review. Root application, authorization, CI-window and release records bind older private bytes and remain stale. The final61 runner is `DRAFT_NOT_AUTHORIZED_NOT_EXECUTED`; only root may regenerate exact-byte records and consider a separate isolated run. This verdict grants no actual runtime acceptance, G11/config/task exception, three-date carry-forward, deployment, merge, cutover, product-browser or P0 phase-finalizer clearance.

**Reviewed head:** `08842235047a3ab2714427edce80331b94558150`  
**Reviewed private manifest:** `26e71e4884fbf37eaa16804f6b0469255a0bb79284fe7b5fa189f3adbbc765bc`
