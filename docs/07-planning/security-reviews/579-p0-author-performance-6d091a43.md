# P0 complete performance batch — author evidence

**Source head:** 6d091a432a3cedb8861dc186483715beccbaba84
**Author model:** GPT-6 Luna, independent from neither implementation nor remediation.
**Verdict:** author verification only; hosted acceptance and independent review pending.

The complete batch removes redundant list wrappers, applies optimistic status after synchronous query cancellation without waiting for transport settlement, contains mounted sortable board cards, and preloads the existing lazy create dialog on trigger intent. Mutation requests retain cancellation-before-write ordering, full-task/version authority, rollback and stale-response protection.

## Actual checks

- Final clean-source build: agent and portal pass. Manifest SHA-256: agent `08b4a0abb53fe90ec5d465103a2270face0722070feed70b8342618280e89c73`; portal `8696ad4db1a9d4f6e54c38d809b2953cbe76c9eb4b6e47e590982232d8c356d4`.
- Web typecheck and targeted Biome pass. Focused list/optimistic tests: 2 files / 19 tests before a test compile annotation/format correction; typecheck rerun afterward passes.
- Freshly built scoped list browser: 1/1, all 500 rows / 1,000 links mounted, WLP-500 keyboard reach, normal/200% geometry, active intrinsic probe +82 px with exact restoration.
- One final canonical local performance run: 22/22 in 5.0 minutes. List median185.6 ms, LCP2128 ms, create80.0 ms, status78.1 ms, assignment80.9 ms, comment70.0 ms, route first paint63.4 ms, board284.0 ms, drag p9516.8 ms. Canonical budgets/sample counts/retries/assertions unchanged.
- All three drag samples retain 100 writes each, HTTP200, CSRF and quoted If-Match. Keyboard menu/cancel and 200% reachability pass.

Complete raw output, exact source/build identities and earlier failed/stale attempt history are retained privately under `p0-performance-takeover-500c491b/`. Earlier ineffective native table-cell containment and stale-build attempts remain failures; they grant no current-source proof. Accidental broad wrapper selections are retained separately, not counted as scoped passes.

## Screens opened

Built seeded work-item list, work-item detail controls/create dialog, and 200-card board were exercised through canonical browser fixtures. The scoped list layout check verifies normal and 200% geometry and terminal keyboard reach. These are browser fixture journeys, not authenticated interactive OrbStack/real-provider acceptance. Complete canonical fixtures retain their declared viewport and data sizes; no new viewport claim is added here.

## Limits

Prior hosted500c491b run37230109147 fails G11 18/22, despite PostgreSQL136 files /1,649 tests /5 tasks and G4/G8/E2E passing. Local6d22/22 does not clear that failure. No current independent review, protected merge, DEV refresh, three-date cutover, or P0 completion is claimed. Prior genuine b8 review/runtime records remain attributed to b8.
