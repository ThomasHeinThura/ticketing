# Security review — service calendar management (#513)

**Reviewer:** GPT-6 Sol, fresh independent context. The reviewer did not author, direct, or remediate this change.
**Reviewed head:** `2d4bf2d9c3698dbf646a6201331252530d8b6dc2`
**Pull request:** #513, `feat(p2): add service calendar management`
**Base:** `6a93fb3b75f7aa90bcff127ccf545eb5b3ad1670`
**Date:** 2026-09-30

## Scope

Reviewed the service-calendar API schema and create/PATCH paths, workspace reach and role checks, API-key scope, data writes, timezone validation across API/domain/UI, and new fixed-offset regression cases. The reviewed delta adds canonicalized timezone validation and its tests.

## Review

**Verdict: CLEAR.** No concrete security blocker or additional risk finding in the reviewed head.

Confirmed that domain `isIanaTimeZone()` and UI `isValidIanaTimezone()` inspect `Intl.DateTimeFormat(...).resolvedOptions().timeZone` and reject canonical timezone identifiers beginning with `+` or `-`. The API request schema uses the shared domain validator, and calendar creation and updates validate before database writes. The validation accepts `UTC` and named IANA zones while rejecting short, compact, and colon-form fixed offsets. Regression coverage includes `+05:00`, `-03:30`, `+05`, `+0500`, and `-0330` in the relevant domain, UI, and HTTP integration layers.

The review also checked workspace reach, caller role authorization, API-key permission narrowing, and the surrounding persistence path; the timezone change does not alter those controls. No new secret exposure or authority expansion was found.

## Evidence

- `git diff --check` — clean.
- GPT-6 Sol `Intl` reproduction — signed canonical offset IDs are rejected; `UTC` and `America/New_York` remain accepted.
- `pnpm --filter @taskdesk/domain test` — 12 files / 562 tests passed.
- `pnpm --filter @taskdesk/web exec vitest run src/lib/service-calendar-form.test.ts` — 1 file / 6 tests passed.
- Node 24, `CI=1`, isolated Testcontainers Postgres 18: focused `service-calendar.test.ts` — 12/12 passed.
- API and web typechecks passed.

## Residuals

This review clears the security-sensitive code at the reviewed head. It does not claim that PR #513 completes P2 acceptance. Calendar event outbox delivery and AU-14 alerting remain unavailable, direct deletion remains withheld pending the approved pending-action route, and browser verification remains blocked until a separate development host is available. CI dependency audit is also blocked by advisories being handled on PR #519; G8 is not enabled as a required check.
