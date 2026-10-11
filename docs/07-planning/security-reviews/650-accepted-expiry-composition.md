# PR #650 — accepted expiry composition reviews

**Reviewed head:** `6d43350adffad67702d401ef0e0f4c0c881d67ec`

These fresh independent bounded composition reports preserve earlier feature/security reviews and the original failed G11 result. They grant no waiver, cause clearance or overall acceptance.

## Original report: 650-accepted-expiry-composition-independent-luna.md

SHA256: `32a37f64a8b51842ca9234a363c31940d342ea5015fe6315272459aa5ae4479c`

# PR #650 accepted-expiry composition — independent ordinary review

**Verdict: CLEAR for the bounded accepted-main composition at this exact head.** No blocking findings. One non-blocking formatting observation is recorded below.

- **Reviewed head:** `6d43350adffad67702d401ef0e0f4c0c881d67ec`
- **Reviewed tree:** `707d54111c95300700791ffbbf0b679ca7c9c420`
- **Composition merge:** `6d43350adffad67702d401ef0e0f4c0c881d67ec`
- **Merge parents:** #650 native client source `633273f9130769be60c2e93aee1f5d73642b2bd9`; accepted main `00c6c82e4fe44f443f51be755c8b04febd32c35d`
- **Comparison base:** prior reviewed #650 source `633273f9130769be60c2e93aee1f5d73642b2bd9`
- **Reviewer:** independent ordinary-review context assigned GPT-6 Luna by the dispatching session. The execution environment did not expose separate model-selector or serving-variant metadata. I did not author, direct, or remediate this composition.
- **Scope:** accepted-main expiry and delivery-record composition into the selected #650 native client candidate; preservation of its four selected native source blobs, prior #638 assertions and accurately bounded G11 evidence.

## Scope and result

I read the #650 accepted-S7 and accepted-OpenAPI composition notes, the accepted MFA composition note, the #638 legacy WebSocket review record, and the current accepted-main expiry note. I inspected the merge and its parent-relative changed paths, the intervening merge-aware history, the relevant source blob identities, and the private #650 G11 failure and diagnosis records.

The merge imports exactly 13 paths relative to the #650 parent: the accepted expiry migration/schema/scheduler/spec/test paths and accepted planning, status and review records. Those 13 blobs compare byte-identically to accepted main `00c6c82e`. The expiry code is therefore the already accepted source; this composition adds no new expiry behavior or gate semantics.

The four selected #605 owner files match their preserved source blobs from `27b344f33cd1356c38b7254525e9c30b57ddbb96` exactly at this head:

- `apps/web/src/hooks/use-native-work-item-realtime.ts` — `ee477f942bfc572715805442fde3e772f78d4f76`
- `apps/web/src/hooks/use-native-work-item-realtime.test.tsx` — `69214d64522f74abdec2dd54343fb9f5863511e8`
- `docs/01-architecture/realtime.md` — `15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef`
- `tests/api-integration/node-server-websocket.test.ts` — `0c1f512076da88e3771f3d8a58729281ddb08639`

The websocket integration test has a later change compared with the original #638 reviewed blob, but its diff is confined to the separate public-comment event case (48 insertions and 2 event-count adjustments). The preceding #638 legacy authorization assertions are unchanged. This agrees with the accepted-S7 note's preservation of the 189 assertion lines; I did not run the WebSocket or permission suites.

## G11 evidence and limits

I verified the raw exact-#650 `633273f9` G11 log. It records the canonical 200-task board render median at `506.0 ms` initially, then `513.7 ms` after the permitted retry set, against the unchanged strict `<500 ms` budget. This remains a real G11 failure on `633273f9`; the later accepted-main composition does not alter that source-bound result or establish a new G11 run.

The separate exact-`633273f9` diagnostic with the reviewed `22253f5c` persistence overlay completed all five phases and retained the board window, but failed at task-state clock alignment (`1005.9974087050558`). The private board-source diagnosis reports the independently aligned board interval and explicitly says it supports no narrow product defect or repair. I found no claim in the reviewed composition notes that should be read as clearing the newer exact-`633273f9` failure. The earlier `37db` hosted G11 pass is a distinct result and does not apply here.

This is a composition review only. It does not clear G11, identify a performance cause, authorize a repair, establish current hosted checks, or provide overall #650 readiness.

## Findings and checks

- No blocking finding in this bounded composition.
- **Non-blocking formatting observation:** `git diff --check 633273f9..HEAD` reports trailing spaces and a terminal blank line in the imported verbatim #660/#663 review notes. I left those report bytes unchanged. This does not alter product behavior or gate semantics.
- Selected 13 incoming paths compare exactly with accepted main — passed.
- Four native owner-file blob comparisons with the preserved source — passed.
- Diff from the #638 reviewed websocket test shows changes only in the later public-comment event case; earlier legacy authorization assertions are unchanged.
- Read-only review of exact-head G11 raw log and compact diagnosis record — claims align with the source-bound outcome above.
- No tests, builds, browser, database, Docker, or shared runtime were run. No files in the repository were modified.

## Original report: 650-accepted-expiry-composition-security-sol.md

SHA256: `bc013255527752aa14bdb90d3e16d3ec5fd6a4e52d8f1cf767a06492a8125637`

# PR #650 accepted-expiry composition — independent security confirmation

**Verdict: CLEAR for the bounded accepted-main composition at this exact head.** No blocking or non-blocking security finding in this composition. This lightweight confirmation is additive to prior full reviews of the source; it does not clear G11 or establish overall PR readiness.

- **Role and independence:** Fresh independent security reviewer. I did not author, direct, or remediate the candidate and did not modify the repository.
- **Model provenance:** Dispatched for the GPT-6 Sol security-review role in a fresh independent context. This execution environment does not expose separate serving-variant metadata, so no more specific platform-version claim is made.
- **Exact reviewed head and tree:** `6d43350adffad67702d401ef0e0f4c0c881d67ec` / `707d54111c95300700791ffbbf0b679ca7c9c420`.
- **Comparison base:** prior reviewed #650 native candidate `633273f9130769be60c2e93aee1f5d73642b2bd9` (normal merge first parent).
- **Accepted-main second parent:** `00c6c82e4fe44f443f51be755c8b04febd32c35d`.
- **Prior independent ordinary composition review:** `E/E/650-accepted-expiry-composition-independent-luna.md`, SHA-256 `32a37f64a8b51842ca9234a363c31940d342ea5015fe6315272459aa5ae4479c`, CLEAR for this exact head.

## Security check

I read the accepted operating and review policy, active integration mission, CI security-scope path list, independent ordinary composition report, accepted #650 S7 composition note, accepted #663 expiry review note, and source-bound #650 G11 failure and diagnostic records. I checked both merge parents and parent-relative history and path lists. Both parents are ancestors of this head; the sole new candidate commit is the normal two-parent merge.

Relative to #650 first parent `633273f9`, the merge imports exactly 13 accepted-main paths: expiry migration SQL, snapshot and journal, schema, scheduler, architecture contract, integration test, and planning/status/review records. Every imported path compares byte-identically to accepted main `00c6c82e`; there is no merge-specific edit to expiry or migration semantics. The prior #663 full source security review and its correction remain bound to their reviewed source, and this confirmation does not relabel them.

Relative to accepted main, the native delta is the selected #605 realtime hook and test, architecture text, WebSocket integration test, and existing #650 review records. The four owner files compare byte-identically to #650 first parent and to source `27b344f33cd1356c38b7254525e9c30b57ddbb96`: hook `ee477f942bfc572715805442fde3e772f78d4f76`, hook test `69214d64522f74abdec2dd54343fb9f5863511e8`, realtime contract `15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef`, and WebSocket integration test `0c1f512076da88e3771f3d8a58729281ddb08639`. The accepted S7 review records preservation of the earlier #638 legacy authorization assertions, including its 189 assertion lines; no native blob changed in this composition. I found no new auth, tenancy, WebSocket authority, migration, CI-control, or gate pass/fail semantics introduced by this merge.

## Verification and limits

- Parent ancestry and per-parent path lists passed. The 13 incoming paths compared equal to accepted main; the four selected native owner files compared equal to the reviewed #650 parent and preserved source. `git diff --stat` from the first parent showed only the 13 imported paths. The worktree remained clean.
- `git diff --check 633273f9..6d43350a` reports trailing spaces and a terminal blank line in imported verbatim #660/#663 review notes. This is the same non-blocking formatting observation in the ordinary report; altering authenticated report bytes was outside this review.
- I read the compact exact-`633273f9` failure receipt and raw G11 lines: canonical 200-card board median was `506.0 ms` initially and `513.7 ms` after the permitted retry, above the unchanged strict `<500 ms` budget. At review time GitHub PR #650 still pointed to `633273f9` and its G11 status was FAILURE. Those hosted results are source-bound to that remote head, not checks for this local merge.
- The separate exact-`633273f9` diagnostic with reviewed #661 persistence overlay retained five windows but exited 1 at task-state alignment scale `1005.9974087050558`. Its offline board mapper exited 0 at scale `1000.0604026845638`; the private diagnosis explicitly supports no narrow product repair or G11 clearance.
- I did not run tests, database, browser, build, Docker, image boot, or a new G11 workload. The root session's current intake capture and any subsequent exact-head hosted checks are separate gates. This report grants no waiver, merge approval, release, SIT promotion, issue closure, or stage completion.

