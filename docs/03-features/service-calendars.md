# Service calendars

- **Stage:** P2
- **Status:** ⬜
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
`holidays` jsonb.

```jsonc
{
  "windows": {
    "mon": [{ "from": "09:00", "to": "17:00" }],
    "tue": [{ "from": "09:00", "to": "17:00" }],
    "wed": [{ "from": "09:00", "to": "12:00" }, { "from": "13:00", "to": "17:00" }],
    "sat": [],
    "sun": []
  },
  "holidays": [
    { "date": "2026-12-25", "name": "Christmas Day" },
    { "from": "2026-12-27", "to": "2026-12-31", "name": "Company shutdown" }
  ]
}
```

Multiple windows per day are supported, which is how a lunch break or a split shift is
expressed.

## Behaviour

- `CAL-1` A calendar has exactly one timezone. All windows are interpreted in it.
- `CAL-2` Windows may not overlap within a day. Overlaps are rejected at save.
- `CAL-3` A window ending at `24:00` means midnight at the end of that day. A window may
  not span midnight; use two windows on consecutive days.
- `CAL-4` A holiday removes all cover for that date, regardless of windows.
- `CAL-5` A calendar with no windows on any day provides zero cover. Allowed, warned
  about, and produces `none` for every SLA measured against it.
- `CAL-6` Timezone handling uses a real IANA timezone database. DST transitions are
  handled by the library, never by arithmetic on offsets.
- `CAL-7` During a DST spring-forward, an hour that does not exist is skipped. During
  autumn fall-back, the repeated hour is counted once.
- `CAL-8` Changing a calendar takes effect immediately for all SLAs measured against it,
  because SLA state is computed on read. The editor warns and shows how many open work
  items are affected.
- `CAL-9` A calendar in use cannot be deleted. It must be replaced on every policy and
  project referencing it first, and the UI lists them.

## Holiday management

- `CAL-10` Holidays are entered manually, imported from an `.ics` file, or generated from
  a country preset for a given year.
- `CAL-11` Country presets are shipped for common jurisdictions and are a starting point,
  not authority — the administrator confirms them.
- `CAL-12` A recurring holiday (every 25 December) is stored as a rule and expanded
  per year.
- `CAL-13` Adding a holiday retroactively moves deadlines later. Warned about, with a
  count of affected items.

## Permissions

| Action | Capability |
| --- | --- |
| Read | `sla_policy:read` |
| Create, edit, delete | `sla_policy:manage` |

## Screens

**Calendar list** — name, timezone, weekly cover total, how many policies and projects use
it.

**Calendar editor** — a week grid with draggable window blocks, a timezone selector, and a
holiday list with a year picker. Beside it, a live preview: "This calendar provides 40
hours of cover per week, 1,992 hours in 2026 after holidays."

The preview matters. Without it, an administrator cannot tell whether they have configured
what they meant, and calendar mistakes are silent and expensive.

## API

```
GET    /api/service-calendars                 sla_policy:read
POST   /api/service-calendars                 sla_policy:manage
GET    /api/service-calendars/{id}            sla_policy:read
PATCH  /api/service-calendars/{id}            sla_policy:manage
DELETE /api/service-calendars/{id}            sla_policy:manage
POST   /api/service-calendars/{id}/holidays/import   sla_policy:manage
GET    /api/service-calendars/{id}/preview?year=2026 sla_policy:read
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Customer in a different timezone from the calendar | Deadlines are displayed in the viewer's timezone with the calendar's name shown, so there is no ambiguity |
| Holiday falling on a day with no windows anyway | No effect. Allowed |
| Overlapping holiday ranges | Merged |
| Window of zero length | Rejected |
| Calendar timezone changed | Recomputes everything. Strongly warned; requires confirmation |
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
