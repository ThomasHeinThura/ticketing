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
  because SLA state is computed on read. Changing its timezone requires explicit
  confirmation before save. The editor shows how many open work items are affected when
  usage data is available; this count remains outstanding until `/usage` can be implemented
  after project calendar references (#437) and the `sla_policy` table exist.
- `CAL-9` A calendar in use cannot be deleted. It must be replaced on every policy and
  project referencing it first, and the UI lists them (`GET
  /api/service-calendars/{id}/usage`, below).

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
  mutation still commits (`AU-14`) and the failure is written to the error log. The
  required alerting metric and notification to every instance administrator are not
  available in this slice; audit-failure reporting is not acceptance-complete until those
  AU-14 integrations exist. Calendar configuration has no secrets; audit before/after
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
- A `service_calendar.*` event must be recorded in the durable outbox in the same
  transaction as its calendar mutation (`EV-1`). Create and update now write their
  catalogue event envelopes transactionally. They do not use the post-commit in-memory
  `publishEvent` emitter as a substitute. Deletion remains unavailable, so no delete event
  is written.
- Calendar deletion is unavailable until the server-enforced pending-action mechanism is
  implemented. When available, `DELETE /api/service-calendars/{id}` must create a pending
  action and return `202` per `pending-actions.md` (`PA-1`–`PA-15`); it must not delete the
  calendar directly.

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
holiday list with a year picker. Beside it, a server-calculated preview for the selected
year. The preview currently reflects the last saved settings; saving is required before it
reflects editor changes. Changing an existing calendar's timezone opens a confirmation
warning. The affected-item count is not shown because `/usage` is still blocked by #437 and
the missing `sla_policy` table.

The preview matters. Without it, an administrator cannot tell whether they have configured
what they meant, and calendar mistakes are silent and expensive.

## API

```
GET    /api/service-calendars                 sla_policy:read
POST   /api/service-calendars                 sla_policy:manage
GET    /api/service-calendars/{id}            sla_policy:read
PATCH  /api/service-calendars/{id}            sla_policy:manage
POST   /api/service-calendars/{id}/holidays/import   sla_policy:manage
POST   /api/service-calendars/{id}/holidays/preset?country={cc}&year={yyyy} sla_policy:manage
GET    /api/service-calendars/{id}/preview?year=2026 sla_policy:read
GET    /api/service-calendars/{id}/usage             sla_policy:read
```

### Backend slice status (2026-10-01)

The persisted create/update/list/detail and annual preview routes are implemented. Create
and update write audit records and durable event envelopes in their mutation transactions;
an audit insert failure is isolated to its savepoint and logged while the mutation and
outbox event commit. The preview uses the shared `packages/domain/src/calendar/`
calculations. The remaining routes are not implemented in this slice:

This slice also does not seed workspace calendars with named presets or implement calendar
cloning. The calendar list/editor UI now covers manual calendar creation, editing, and
saved-settings coverage preview. Issue #33 remains open: reference counts, safe deletion,
presets, cloning, ICS import, country holidays, and the remaining CAL behavior and
acceptance tests have not been completed. No Follow the sun window pattern is defined or
inferred here.

- `/usage` waits on project calendar references (tracked by #437) and the not-yet-created
  `sla_policy` table. It must report real references before CAL-9 deletion protection can
  be enforced.
- Holiday import waits on a written `.ics` profile: supported component/property set,
  timezone handling, recurrence expansion, invalid-entry behavior and duplicate handling.
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

E2E: edit a calendar, observe an open work item's due time change on the next render.

## Open questions

None.

## Related

- [SLA](sla.md) · [ADR 0009](../01-architecture/adr/0009-lazy-sla-evaluation.md)
