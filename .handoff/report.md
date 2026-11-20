# Settings History group gm

Note: the worktree did not exist at the given path; created it from origin/main (fe5d4125b) on branch feat/settings-history-gm.

## Per screen
- Webhook configuration (per webhook): done. API entity `webhook` (webhook:manage, workspace row scope) and producers already existed. Mounted lazily in `webhook-editor.tsx` before the delete card; meta.audits already declared. New integration test `tests/api-integration/settings-history-webhook.test.ts` (owner 200 with rows; viewer and other-workspace manager refused).
- Local sign-in methods: done. `instance_auth_methods` mounted lazily in `local-sign-in-methods-card.tsx`; audits already declared. Covered by existing P3 integration test (passes).
- Staff registration: done. `staff_self_registration` mounted in the same card (same save writes both rows).
- Instance job configuration: done. `instance_job` mounted per configurable job in `instance-jobs-panel.tsx` (jobs without a schedule have no History).
- Identity connections: done. `identity_connection` mounted in `identity-connection-editor.tsx` for a stored connection only (covers staff and organisation editors; OIDC mappings and SCIM mutations already audit the same target).
- Import-source connections: skipped. Creation is audited (`plugin.changed`, meta.audits declared in connect-step) and the API reads `import_source_connection` (covered by P3 integration), but the product has no screen for an existing source: the wizard only creates or reuses one and there is no update route, so a History there would show one creation row inside a wizard step.

## Labels
Actions webhook_created/updated/deleted/secret_rotated/auto_disabled, job_configuration_changed, identity_connection_changed; fields authAgent/authCustomer x Password/MagicLink/EmailOtp, staffSelfRegistration, enabled, schedule, in all 19 catalogs (translations written for this change; the existing identityConnections sign-in terms are English in non-English catalogs, so they were not reused). `i18n/schema.json` regenerated. Inventory test extended (34 actions, 44 settings actions). `settings-history.tsx` LABELLED_FIELDS gained the three types.

## Tests and gates
- web focused (god-mode, webhook, settings, query-client): 78 files / 937 tests pass. Manifest test passes.
- api tests/api/audit: 19 files / 111 pass. Integration (Testcontainers, CI=true): settings-history-webhook 3/3, settings-history-p3 2/2.
- test:permissions, check:route-policy: pass. test:contract: no API change, no breaking changes.
- typecheck, lint:ci, check:ui:raw-elements: pass. check:i18n: only the 86 known vi-VN plural keys.
- web build; check:tokens needed `refresh-contrast-manifest.mjs --write` (272 additive occurrence ids in pairs.json, no pairs or thresholds changed), then passes.
- Bundle: agent 277426, agent-work-list 348386 (<= 349300), portal 197806. History stays lazy.
- Not run: browser tests, visual regression, full unit suite.
