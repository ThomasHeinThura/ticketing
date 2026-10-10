# Independent ordinary review — P0 test batch delta

**Reviewer/model:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate this candidate.

**Reviewed head:** `307eeea23049df4aa960bf4283d64a18d7ff8dff`

**Comparison:** `8f6ca5375171eb0740fae7d4eecfe56deaef2c0b..307eeea23049df4aa960bf4283d64a18d7ff8dff`

**Verdict: CLEAR — no blocking findings.** This is a test-only three-file delta. Review was limited to the two documented masked-404 test expectation corrections and the faithful MFA/CSRF plus observability browser-test split and locator helper. This is not a phase finalizer or hosted acceptance claim.

## Files and findings

- `apps/web/e2e/mfa-csrf-journey.spec.ts`: the first test enrolls TOTP, confirms enrollment rotated the session, signs out and completes both TOTP and backup-code sign-in challenges, then issues all three original CSRF rejection requests in that same MFA-authenticated session. It checks exact denial reasons and rereads the protected setting/version after every denied write. The second test retains the normal UI edit/read/version/restore sequence.
- The option helper scopes each ordinary pointer click to the listbox named by the selected trigger's current `aria-controls`, asserts the expanded/visible listbox and unique option, and checks selected value plus collapsed/hidden state. It does not add a keyboard bypass, forced click, timeout increase, retry, mock, or direct settings write. Save waits for the matched 200 response and enabled button; API readback/version assertions verify persistence and restoration.
- `tests/api-integration/work-item-assignable.test.ts`: only the unknown-project expected status changes from 400 to 404.
- `tests/api-integration/work-item-list-sort-pagination.test.ts`: the non-member masked-reach expectation/comment changes from 400 to 404. No route, policy, or API implementation changes are present in this delta.

No blocker or additional source correction found. Non-blocking residual: the original hosted run remains 25 passed / 1 timeout, and the exact hosted timeout mechanism is not established by this review.

## Checks actually run by this reviewer

- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/work-item-assignable.test.ts ../../tests/api-integration/work-item-list-sort-pagination.test.ts` — **2 files, 43 tests passed**.
- `pnpm --filter @taskdesk/web exec tsc --noEmit --pretty false` — passed.
- `pnpm exec biome check apps/web/e2e/mfa-csrf-journey.spec.ts tests/api-integration/work-item-assignable.test.ts tests/api-integration/work-item-list-sort-pagination.test.ts` — passed, 3 files.
- `git diff --check 8f6ca5375171eb0740fae7d4eecfe56deaef2c0b..307eeea23049df4aa960bf4283d64a18d7ff8dff` — passed.
- `pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts e2e/mfa-csrf-journey.spec.ts` — **not run to completion**: Playwright refused startup because `http://127.0.0.1:4178/auth/sign-in` was already in use. I did not stop or alter that process. The retained private evidence `mfa-restored-realtime-actionability.md` reports the source-equivalent two-journey run passing **2/2** (8.8s and 10.2s), but that is author evidence, not a rerun by this reviewer.

## Scope and residuals

Inspected the MFA enrollment/session rules in `docs/01-architecture/auth-and-identity.md`, CSRF contract in `docs/01-architecture/security-model.md`, and observability contract in `docs/03-features/god-mode.md`. No application source, runtime, CI, or authorization semantics change in this delta. Runtime/CI, current hosted acceptance, exact hosted timeout cause, and the P0 GPT-6 Sol phase finalizer remain outside this verdict and open.
