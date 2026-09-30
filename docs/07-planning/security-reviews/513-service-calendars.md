# Security review — service calendar management (#513)

**Current candidate:** `feat/p2-33-service-calendars` after merge of `origin/main` at `7d21bc8f`.
**Current security verdict:** **PENDING — fresh GPT-6 Sol review required.**
**Prior review:** GPT-6 Sol independently reviewed `2d4bf2d9c3698dbf646a6201331252530d8b6dc2` against base `6a93fb3b75f7aa90bcff127ccf545eb5b3ad1670` on 2026-09-30. That review remains valid only for that exact head; it does not attest to the current candidate.

## Prior review scope and verdict

The prior reviewer examined the service-calendar API schema and create/PATCH paths, workspace reach and role checks, API-key scope, data writes, timezone validation across API/domain/UI, and fixed-offset regression cases. The verdict was clear for the reviewed head: no concrete security blocker or additional risk finding.

That review confirmed the shared domain and UI timezone validators reject canonical timezone identifiers beginning with `+` or `-`, while accepting `UTC` and named IANA zones. The API request schema uses the shared domain validator, and calendar creation and updates validate before database writes. The review also checked workspace reach, caller role authorization, API-key permission narrowing, and the surrounding persistence path.

## Current candidate evidence

- Current candidate includes the normal merge commit from `origin/main` at `7d21bc8f`.
- Focused PostgreSQL 18 integration suite: `service-calendar.test.ts`, 13/13 passed with `CI=true` and Testcontainers.
- API typecheck passed.
- `pnpm check:events` passed: all 31 published event keys are registered.
- Biome check passed for the changed API and calendar route surfaces.
- `pnpm --filter @taskdesk/api db:generate` reported no schema changes; migration journal retains the single `0079_service_calendar` entry after `0078_outbox`.
- Docker image built; its migration role applied the migrations to a fresh PostgreSQL 18 database, and the app container returned HTTP 200 from `/api/public/health/ready`.

These checks are implementation evidence, not a security review. No independent reviewer has reviewed the exact current candidate yet.

## Residuals

CAL-8 affected-item count remains blocked on issue #437 linkage and the `sla_policy` table. AU-14's required alerting metric and instance-administrator notification infrastructure remain unavailable. Direct deletion remains withheld pending the approved pending-action route. The candidate still needs fresh independent Luna review(s), current-head GPT-6 Sol security review, and required CI/browser gates before merge.
