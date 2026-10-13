# Service calendars

- **Stage:** P2
- **Status:** 🟡
- **Feature flag:** `feature.sla`
- **Depends on:** nothing

## Purpose

Define which hours count. Everything about SLA measurement depends on this: a four-hour
target means four hours of *contracted cover*, not four hours of clock.

A calendar is also how a managed service expresses what it sold — 8×5 business hours,
12×5 extended, or 24×7.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Calendar** | Named set of weekly windows, a timezone, and a holiday list |
| **Window** | A start and end time on a given weekday, e.g. Monday 09:00–17:00 |
| **Holiday** | A date, or a date range, on which no window applies |
| **Cover** | The union of all windows minus holidays |

## Presets

Seeded on workspace creation, all editable, all clonable.

| Preset | Windows |
| --- | --- |
| **24×7** | Every day, 00:00–24:00. No holidays |
| **8×5 business hours** | Mon–Fri 09:00–17:00 |
| **12×5 extended** | Mon–Fri 07:00–19:00 |
| **Follow the sun** | Multiple windows per day across regions |

## Data

`service_calendar` — `workspace_id`, `name`, `timezone`, `windows` jsonb,
`holidays` jsonb, `created_at`, `updated_at`, and `version integer not null default 1`.
The timestamps follow the shared data-model convention; `version` marks calendars as
optimistically concurrent resources.

```jsonc
{
  "windows": {
    "mon": [{ "from": 540, "to": 1020 }],
    "tue": [{ "from": 540, "to": 1020 }],
    "wed": [{ "from": 540, "to": 720 }, { "from": 780, "to": 1020 }],
    "sat": [],
    "sun": []
  },
  "holidays": [
    { "date": "2026-12-25", "name": "Christmas Day" },
    { "from": "2026-12-27", "to": "2026-12-31", "name": "Company shutdown" },
    { "recurs": "annually", "month": 1, "day": 1, "name": "New Year's Day" }
  ]
}
```

`windows[].from`/`.to` are minutes-from-midnight, `0..1440` (`09:00` = `540`, `17:00` =
`1020`) — not `"HH:MM"` strings; see `CAL-3`. Multiple windows per day are supported,
which is how a lunch break or a split shift is expressed. `holidays` takes three shapes —
a single date, an inclusive range, or a `{recurs, month, day}` rule for a date that
repeats every year (`CAL-12`).

## Behaviour

- `CAL-1` A calendar has exactly one timezone. All windows are interpreted in it.
- `CAL-2` Windows may not overlap within a day. Overlaps are rejected at save.
- `CAL-3` Window boundaries are minutes-from-midnight, `0..1440` (see Data, above). A
  window ending at `1440` means midnight at the end of that day; `1440` never appears as
  a window's `from`. A window may not span midnight; use two windows on consecutive days.
- `CAL-4` A holiday removes all cover for that date, regardless of windows.
- `CAL-5` A calendar with no windows on any day provides zero cover. Allowed, warned
  about at save — the clock never advances, so items measured against it remain `ok`
  indefinitely.
- `CAL-6` Timezone handling uses a real IANA timezone database. DST transitions are
  handled by the library, never by arithmetic on offsets.
- `CAL-7` During a DST spring-forward, an hour that does not exist is skipped. During
  autumn fall-back, the repeated hour is counted once.
- `CAL-8` Changing a calendar takes effect immediately for all SLAs measured against it,
  because SLA state is computed on read. A published SLA policy version immutably pins the
  calendar ID and its own goals/threshold; evaluation resolves that ID to the calendar's
  current definition. Editing a calendar never rewrites a published policy version or
  captures a private copy of calendar windows/holidays/timezone. Changing its timezone
  requires explicit confirmation before save. The usage endpoint returns live project,
  policy-version, current-policy, and work-item references. The count is informational and
  does not replace the explicit timezone confirmation.
- `CAL-9` A calendar in use cannot be deleted. It must be replaced on every policy and
  project referencing it first. The usage screen reports aggregate references without
  exposing project or work-item names to a calendar reader (`GET
  /api/service-calendars/{id}/usage`, below). Deletion requires the existing pending-action
  request and browser approval; both request and approval recheck references.

## Holiday management

- `CAL-10` Holidays are entered manually, imported from an `.ics` file, or generated from
  a country preset for a given year (`POST .../holidays/preset`, below). Preset data is a
  versioned dataset bundled with the release — no external service call at request time —
  refreshed each release; per `CAL-11`, it is a starting point, never authority.
- `CAL-11` Country presets are shipped for common jurisdictions and are a starting point,
  not authority — the administrator confirms them.
- `CAL-12` A recurring holiday (every 25 December) is stored as a `{recurs: "annually",
  month, day}` rule (see Data, above) and expanded at read time: `isHoliday` and every
  coverage query check the rule directly against the date in question. Nothing is
  pre-expanded or persisted per year.
- `CAL-13` Adding a holiday retroactively moves deadlines later. Warned about, with a
  count of affected items.
- `CAL-14` Creating or updating a calendar writes one `audit_log` row in the same
  database transaction as the calendar mutation. If the audit insert fails, the calendar
  mutation still commits (`AU-14`). The bounded `mutation` audit-failure metric is
  recorded, and every active instance administrator receives a separate durable
  notification after the calendar transaction commits. Logs and notifications contain no
  raw error or calendar data. Calendar configuration has no secrets; audit before/after
  values contain only the calendar's name, timezone, windows and holidays. The work-item
  `activity` journal does not apply: its authoritative schema requires a `work_item_id`
  composite foreign key, and a calendar has no work item.
- `CAL-15` Calendar responses include `createdAt`, `updatedAt`, and `version`. `PATCH`
  accepts the optional `If-Match: "<version>"` header defined by
  [api-design.md](../01-architecture/api-design.md#concurrency). When supplied, the
  server compares it while holding the calendar row lock; a mismatch returns `409` with
  the asserted and current versions and performs no mutation. Each successful update
  increments `version` and advances `updated_at`. The editor sends the loaded version and,
  after a `409`, keeps the draft available while offering to reload the latest calendar or
  explicitly resubmit that draft against the latest version.
- `CAL-16` Calendar list requests use the shared cursor collection contract. The default
  page size is 50 and `limit` accepts 1–200. Results sort by `(name ASC, id ASC)` and a
  cursor continues within the requested workspace. Each page returns server-issued
  `previousCursor` and `nextCursor` values for the tuple boundaries; either is null exactly
  when that adjacent page does not exist. `hasMore` is true exactly when `nextCursor` is
  non-null. A malformed, unsupported-version, or cross-workspace cursor returns `400`.
  Every page reports the exact workspace total. The list screen keeps one opaque cursor in
  its URL for Next, Previous, deep links, and browser Back. Pages are not a snapshot: rows
  created, renamed, or deleted while paging may change subsequent pages. If the server
  rejects a cursor with `400`, the error state keeps Retry and, when the URL has a cursor,
  offers the existing Reset action to clear it through registered URL navigation and load
  the first page. This also recovers from a cursor bookmarked in a different workspace.
- `CAL-17` Holiday import accepts only UTF-8 RFC 5545 VCALENDAR version 2.0 with finite,
  all-day VEVENT entries. Physical lines use CRLF endings and folded lines are unfolded
  before parsing. Each event requires a syntactically valid UID and DTSTAMP and a
  DTSTART with `VALUE=DATE`; optional DATE DTEND is exclusive and defaults to the next day.
  Stored ranges are inclusive. SUMMARY is optional RFC TEXT with reserved punctuation
  escaped per RFC 5545.
  Reject timed/TZID values, recurrence and exception properties, DURATION, nested/non-event
  components, malformed or unsupported properties, empty input/event sets, invalid real
  dates and any file with one invalid event. The complete allowlist is VCALENDAR VERSION
  (exactly `2.0`), PRODID (non-empty), optional CALSCALE (exactly `GREGORIAN`); and VEVENT
  UID, DTSTAMP, DTSTART, optional DTEND and optional SUMMARY. Reject all other properties.
  Never fetch URLs or execute file content. Limits:
  256 KiB decoded UTF-8 input, 1,000 events, 8 KiB per unfolded content line, 120 Unicode
  characters per name and 366 covered dates per event. Dates must fit canonical calendar
  bounds (years 1–9998). Import is atomic: no valid subset is committed when any event fails.
  Preserve existing holidays. Normalize names as Unicode NFC after trimming surrounding
  whitespace, with case preserved. Identity is exact canonical shape/date or range plus that
  normalized name; exact identities count as duplicates, while different names on the same
  day remain distinct. Retrying an identical import is a no-op: version, updatedAt, audit, outbox event
  and administrator alert do not change. If-Match is still checked under the row lock before
  returning a no-op. A successful import appends to current holidays under that lock,
  increments version once, and uses the existing calendar-update audit action, event and
  audit-failure semantics.
- A `service_calendar.*` event must be recorded in the durable outbox in the same
  transaction as its calendar mutation (`EV-1`). Create and update now write their
  catalogue event envelopes transactionally. They do not use the post-commit in-memory
  `publishEvent` emitter as a substitute. Approved deletion writes its audit and
  `service_calendar.deleted` event in the same transaction.
- `DELETE /api/service-calendars/{id}` creates a pending action and returns `202` per
  `pending-actions.md` (`PA-1`–`PA-15`); it never deletes the calendar directly. Approval
  rechecks the calendar version and all live project/SLA-version references under lock.

## Permissions

| Action | Capability |
| --- | --- |
| Read | `sla_policy:read` |
| Create, edit | `sla_policy:manage` |
| Delete | Unavailable until pending-action approval (`PA-1`–`PA-15`) is implemented |

Deliberately reused rather than a `service_calendar:*` capability of its own: a calendar
has no independent lifecycle outside the SLA policies that reference it. The feature flag
`feature.sla` is shared with [SLA](sla.md) for the same reason — a calendar editor is
meaningless with SLA turned off.

## Screens

**Calendar list** — name, timezone, and weekly cover total. It will also show how many
policies and projects use each calendar once the usage API is available. The current list
and editor screens are implemented; reference counts and safe deletion remain unavailable.

**Calendar editor** — a week grid with draggable window blocks, a timezone selector, and a
holiday list with a year picker and bounded iCalendar file selection, event-name preview and
explicit import confirmation. Beside it, a server-calculated preview for the selected year.
The coverage preview currently reflects the last saved settings; saving is required before it
reflects editor changes. Changing an existing calendar's timezone opens a confirmation
warning. The affected-item count is not shown because `/usage` is still blocked by #437 and
the selected SLA-authoring slice does not define project or work-item policy binding.

The preview matters. Without it, an administrator cannot tell whether they have configured
what they meant, and calendar mistakes are silent and expensive.

## API

```
GET    /api/service-calendars?workspaceId=…&cursor=<opaque>&limit=50  sla_policy:read
POST   /api/service-calendars                 sla_policy:manage
GET    /api/service-calendars/{id}            sla_policy:read
PATCH  /api/service-calendars/{id}            sla_policy:manage
POST   /api/service-calendars/{id}/holidays/import   sla_policy:manage
POST   /api/service-calendars/{id}/holidays/preset?country={cc}&year={yyyy} sla_policy:manage
GET    /api/service-calendars/{id}/preview?year=2026 sla_policy:read
GET    /api/service-calendars/{id}/usage             sla_policy:read (aggregate counts only)
DELETE /api/service-calendars/{id}                   sla_policy:manage (pending action; no direct deletion)
```

The list response follows the generic collection envelope with calendar navigation edges:
`{data: ServiceCalendar[], page: {previousCursor: string | null, nextCursor: string | null, hasMore: boolean}, meta: {total: number}}`.
Each cursor is opaque, workspace-bound, direction-bound, and encodes a `(name, id)` tuple.
Forward and backward requests both return rows in ascending `(name, id)` order. If a stale
cursor produces an empty page, both cursors are null and the UI offers a return to the first
page. If a cursor is rejected, the error state preserves Retry and offers Reset when a
cursor remains in the URL; Reset clears that URL state and requests the first page.
This operation is new relative to accepted main; there is no previously published GET
response shape to replace in the main-to-PR OpenAPI comparison.

The import request is JSON `{ "ics": string }`; optional `If-Match: "<version>"` uses
CAL-15 concurrency semantics. The response is `{ calendar: ServiceCalendar, importedCount:
integer, duplicateCount: integer }`, with `calendar` using the safe DTO above. Parse and
validate the complete document before mutation; validation failure returns an actionable 400
and changes nothing. The editor offers file selection, preview of names and counts, explicit
confirmation, an all-or-nothing error state, then refreshes calendar and preview after success.
It never presents a successful subset when the server rejects any event. CAL-13 affected-item
counts remain unavailable and must be described as unavailable.

### Backend slice status (2026-10-01)

The persisted create/update/list/detail, annual preview and bounded CAL-17 import routes are implemented. Create
and update write audit records and durable event envelopes in their mutation transactions;
an audit insert failure is isolated to its savepoint, records the `mutation` failure metric,
and notifies active instance administrators after commit while the mutation and outbox event
commit. The preview uses the shared `packages/domain/src/calendar/`
calculations. The usage route is implemented. Country preset routes are not implemented in
this slice:

This slice also does not seed workspace calendars with named presets or implement calendar
cloning. The calendar list/editor UI covers manual calendar creation, editing, saved-settings
coverage preview and bounded file import with confirmation. Issue #33 remains open for
presets, cloning, country holidays, and remaining CAL behavior and acceptance tests. No
Follow the sun window pattern is defined or inferred here.

- `/usage` returns aggregate counts for current project/calendar bindings, every retained
  SLA policy version, the current-version marker, and work items bound to a version, without
  exposing their names or titles. Deletion approval locks the
  calendar, rechecks these references and its version, and only then performs the delete.
- Country presets wait on an authoritative bundled dataset specification naming supported
  country codes, dataset provenance/version and refresh process. No jurisdiction list or
  source is inferred here.

The API codebase has no runtime feature-flag enforcement helper or persisted flag lookup
for `feature.sla` yet, so this route slice does not add a second, ad-hoc flag mechanism.
Deletion is withheld until the pending-action API exists; no direct-delete route is
exposed.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Customer in a different timezone from the calendar | Deadlines are displayed in the viewer's timezone with the calendar's name shown, so there is no ambiguity |
| Holiday falling on a day with no windows anyway | No effect. Allowed |
| Overlapping holiday ranges | Merged |
| Window of zero length | Rejected |
| Calendar timezone changed | Recomputes everything. Requires explicit confirmation; affected-item count stays outstanding until `/usage` exists |
| Leap second | Ignored. Not modelled |
| Country preset for a country with regional holidays | Presets are national only. Regional holidays are added manually |

## Out of scope

- Per-person working hours and capacity → [time-and-cost.md](time-and-cost.md)
- On-call rotas — not in scope for v2

## Testing

Unit tests in `packages/domain/src/calendar/`:

- Covered minutes between two instants for each preset.
- A span crossing a weekend; a span crossing a holiday; a span crossing both.
- Split windows within a day.
- DST forward and backward, in `Europe/London` and `America/New_York`.
- A start instant outside cover — the clock begins at the next opening.
- Year boundaries.
- Zero-cover calendars.
- CAL-17 parser profile, normalization, exclusive DTEND conversion, boundary dates, and
  rejected timed/recurring/unsupported/malformed input and all resource limits.

When the SLA detail read is wired, its browser journey edits a referenced calendar and
observes the open work item's due time change without changing the published policy version.
The API integration test exercises the current database-to-domain evaluation adapter and
proves that the immutable version continues to point at the same calendar ID while the live
calendar definition changes.
The CAL-17 API integration tests cover atomic rejection, duplicate no-op behavior, stale
If-Match ordering, preserved rows, event/audit behavior, and real SQL audit failure. A persisted
browser journey imports a file, verifies the stored response, then rejects a mixed valid/invalid
file and confirms the persisted calendar did not change.

## Open questions

None for CAL-8: policy versions pin calendar identity and policy configuration, while the
calendar definition remains live and is read at evaluation time. See the selected
cross-feature rule in [SLA](sla.md#selected-policy-authoring-contract).

## Related

- [SLA](sla.md) · [ADR 0009](../01-architecture/adr/0009-lazy-sla-evaluation.md)
