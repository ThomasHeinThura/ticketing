# Customer notification preferences (#903)

16 November 2026. Candidate implementation in [draft PR #1197](https://github.com/ThomasHeinThura/ticketing/pull/1197); not merged, released or accepted on signed Local SIT.

NO-21 exposes nine customer event preferences: mentions, public comments, status changes, submission replies/acceptance/declines, and approval requests/expiry reminders/withdrawals. Email choices are per-person and global; in-app delivery stays on. Mentions and approval expiry cannot be digested. Only approval expiry bypasses quiet hours. Existing visibility, current requester/project reach, provider fencing, digest and person locks remain authoritative.

The documented portal preference GET/PUT URL and existing `/canonical` URL share handlers with distinct OpenAPI operation IDs. Portal quiet hours use the existing person fields through a customer-session-only route; no schema or permission change. Exact host admission, explicit-key refusal and handler identity checks retain portal/agent separation. Shared Kaneo preference cards and the existing quiet-hours form are reused, with the staff endpoint/cache retained as defaults. Signed email selectors focus all nine cards and never save on GET.

Acceptance now produces transactional requester inbox/email fanout. Transition recipients include the current requester and assignee without requiring watcher rows. Notification-bearing work-item producers bind the authoritative project organisation inside the existing transaction; current scope changes still suppress queued delivery. The PostgreSQL inbox trigger supplies committed, payload-free WebSocket invalidation.

Thomas approved the 15 additive API response-enum findings on 16 November: seven kinds on canonical GET, seven on canonical PUT, and `submission.accepted` in the portal inbox. Existing kinds remain supported. All 15 exact oasdiff fingerprints are recorded against PR #1197; the unchanged contract gate passed with exactly 15 approved additions and no unapproved changes.

## Executed checks

- Full unit suite: 12/12 tasks; API 353 files / 2,860 tests, web 683 / 5,257 after syncing merged #1196. Full typecheck 9/9 tasks.
- Focused backend 36/36; frontend/CSS/redaction regressions 81/81. The final private signer change also passed the secret-redaction suite 31/31.
- Fresh PostgreSQL 18 integration: 33/33 across five files. Covers all nine preferences, quiet-hours validation/self isolation, actual host/session/key boundaries, portal-off denial without mutation, accepted inbox/email and committed recipient-only WebSocket updates, direct requester transitions without watcher/submission rows, and postqueue organisation-change suppression with no transport call.
- The unchanged contract gate passes with exactly 15 approved enum additions; no other API change is approved.
- Permissions 127/127 and route-policy gate pass. Four self-route fixture entries were added; no existing route or capability value changed. OpenAPI operation IDs are unique (695).
- Lint passes with existing warnings; final rerun after test formatting also passes. Raw controls: zero. Contrast: all 421 pairs pass in built light/dark CSS; only source occurrences were refreshed, without adding/removing pairs or changing thresholds.
- Bundle gates pass: agent 278.0/350 KB gzip; work-list route graph 349.3/350; portal 197.2/200. Headroom is small; no threshold changed.
- Dependency audit: one existing accepted low `deepmerge` advisory, no patched version; no moderate/high/critical. Trivy filesystem scan reports no vulnerabilities; this is not the release image scan.
- Independent Sol high source review: C0/H0/M0/L1. The low quiet-hours copy finding was corrected from an absolute delivery guarantee to “not paused by quiet hours.” All 12 screenshots were independently inspected between the coordinator and reviewer. A test-artifact retention finding was fixed with exact-file finally cleanup and metadata-only absence assertions; the updated browser rerun passed, including both metadata-only absence assertions.

## Persisted browser

`pnpm --filter @taskdesk/web exec playwright test --config /tmp/taskdesk-903-ui-prep/playwright.config.ts`: 1/1 passed in 31.6 seconds on the updated build, including signer-artifact absence assertions against the source-built API and a guarded disposable PostgreSQL fixture. All nine explicit saves survive API reads and reloads; one PUT is deliberately aborted to verify retained draft and explicit retry. Quiet hours save, reload, refuse invalid windows and clear. All nine recipient-bound signed handoffs focus the correct card on a clean URL without changing preferences. Staff cookies are denied on the portal host and valid staff sessions are denied at customer-only agent-host handlers.

Customer desktop 1440, tablet 768 and mobile 390 were captured in actual light/dark themes, with quiet-hours captures at each size/theme (12 screenshots). This does not establish every staff browser role, signed canonical Local SIT, real external SMTP/SES transport or production acceptance. Integration email tests use the synthetic transport seam.

Screenshots: [desktop light](portal-notification-preferences-903/portal-preferences-desktop-light.png), [desktop dark](portal-notification-preferences-903/portal-preferences-desktop-dark.png), [tablet light](portal-notification-preferences-903/portal-preferences-tablet-light.png), [tablet dark](portal-notification-preferences-903/portal-preferences-tablet-dark.png), [mobile light](portal-notification-preferences-903/portal-preferences-mobile-light.png), [mobile dark](portal-notification-preferences-903/portal-preferences-mobile-dark.png), [quiet desktop light](portal-notification-preferences-903/portal-preferences-quiet-desktop-light.png), [quiet desktop dark](portal-notification-preferences-903/portal-preferences-quiet-desktop-dark.png), [quiet tablet light](portal-notification-preferences-903/portal-preferences-quiet-tablet-light.png), [quiet tablet dark](portal-notification-preferences-903/portal-preferences-quiet-tablet-dark.png), [quiet mobile light](portal-notification-preferences-903/portal-preferences-quiet-mobile-light.png), [quiet mobile dark](portal-notification-preferences-903/portal-preferences-quiet-mobile-dark.png).

The first browser setup failed before UI assertions because tsx ignored eval after its tsconfig argument. The helper now executes a private mode-600 ESM file through the existing seeder pattern, keeping the database guard, recipient-bound signatures and redaction. No auth limit, retry budget or timeout was raised.

All eight owned temporary containers were removed by exact ID and confirmed absent:

- Red integration: `3985dc1fbdce0148eedba454ea9200d0f7ea9b3919a76052d9ca4a5173fd34da`.
- First green integration: `5240f9464177264fd393cd8882835c2a5a0788c1914d50c4ac3bd0785ae32f0a`.
- Host regression run: `d5b05cedb2460718864be656153f57a6f13431406633ea14d6f1e5cfff9a3633`.
- Scope regression run: `f16ab575e567251ba48e15bfe3d2ccd6619b3b658049e4f9280d153ee58bc4e9`.
- Final passing integration: `a40421658068cc5ea20591c0c34f47255917a2c96f73a33ba1ea95f1b873d99b`.
- Browser setup diagnostic: `e18da1e5494cbc982ae33d0e2e8a93a2ba5677329448795fbc67f336c7c082aa`.
- First passing browser: `947c6a163798f0a6959f5367dd7c64e0b8c54fefd4ff1a0992915f613c919850`.
- Final passing browser with artifact cleanup: `3c3d589f992147db56f25095359ae64a3f31bccff27214cf6d9e145cdcd40ffb`.

## Remaining acceptance

Merged #1196 is integrated and generated files regenerated. Final local code, type, contrast, bundle, contract and cleanup-browser checks pass after upstream sync. Required CI, including pinned G4/G8, remains pending. Verify the signed release on canonical Local SIT before closing #903. The protected native database and Technexus were not touched.


## G8 fixture and pinned baseline follow-up

Hosted G8 at `4b156bfa3` exposed the old visual fixture returning only two preference rows; the real nine-event API browser journey had already passed. The fixture now returns all nine kinds, retains the existing saved daily-comment preference and its assertion, and supplies null quiet hours plus the normal missing-handoff response. Literal readiness checks cover every card and both urgent explanations; the screenshot comparison remains zero-difference.

Only `portal-account-linux.png` changed. It was regenerated and then verified (1/1) under the Linux amd64 child manifest `sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7` of CI's pinned Playwright index `sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`. The coordinator visually inspected the full nine-card image. The source-scope checker passed with 121 screenshot cases. Owned container `714a8e4ec38c635f2169310844b48371e319052a951daa471a9dcb313b32f376` was removed by exact ID and confirmed absent. Hosted G8 and all required final-head CI checks still need a fresh run.


At `4c87be72b`, all 17 required hosted checks passed once, including G8/G4. Marking the PR ready triggered another run on the same head; G8 caught Timeline and Page detail capturing the independently lazy project header before its navigation loaded. The portal preference snapshot passed. Artifact comparison localized both differences to the header placeholders; page content matched. Those two tests now wait for the existing Overview control before taking their unchanged strict screenshots. No baseline, mask, timeout or tolerance changed.

The three affected/checkpoint screens (Timeline, Page detail, portal preferences), each repeated twice, passed **6/6 in 41.3 seconds** in the same pinned Linux amd64 image, reusing the previously built matching application source. Independent Sol high review of the two failure pairs and four-line readiness fix found C0/H0/M0. Owned container `a62049c7e280b4d579fb5ffbbf9df708c265ec46a7721990bb581ffd505fb43b` was removed by exact ID and confirmed absent. Required hosted checks must pass again on the fix before merge.
