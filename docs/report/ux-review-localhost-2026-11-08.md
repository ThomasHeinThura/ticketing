# UX review of the integrated branch on localhost — 8 Nov 2026

A separate review stack (image built from the open UX and performance PRs merged together, seeded with the demo data) was browsed in Chromium as admin, lead, member, viewer and customer: 453 screenshots at 1440, 768 and 390 px in light and dark, plus console, network, overflow and axe checks. The existing local SIT was not touched.

## What looks right now

The shared page header, the "feature off" states (icon, one line, action), the request-types list and sheet, Members search and tabs, the Security status row, the Reports KPI row, SLA chips in the work list, the portal Approvals empty state, outline "Get help", portal Requests tabs and the phone Filter button.

## Still wrong, by priority

1. **Tablet (768 px).** The desktop sidebar stays open and squeezes content to 420–520 px: Members name column collapses and "(You)" overlaps the role, search is cut off, workflow-state names are clipped and the "No limit" placeholder overlaps the badge in dark mode, the change list scrolls sideways.
2. **Phone work list and board.** Status label on its own line, labels stacked, titles cut near 18 characters, three to four toolbar rows, one filled "active-looking" default sort chip, bare "?" for unassigned, status repeated under a status group header, only three of five board columns at 1440.
3. **Tables on phones and tablets** (Projects, Triage, KB, Work table, Backlog, portal Projects, change list): content 2–3 times wider than the box, no scroll cue, only Title visible.
4. **Backlog** unchanged: To Do above Backlog, stray subtitle, tiny outline priority badges, arrow ordering.
5. **Navigation shows what a role cannot use** (Triage, Timesheet, Members, Invitations for lead, member, viewer); the denial pages are bare centred text.
6. **Feature-off polish:** vertical position differs per page, Reports-off has no description, hidden nav entries still open by URL, Cycles always links to project settings.
7. **Portal:** two announcement banners take 100–150 px on every page, Project column repeats on every row, two absolute timestamps, narrow catalogue column, heading sizes differ, portal project detail overflows at 390 px.
8. **Consistency:** chart series colour differs between themes, raw ISO dates on the Dashboard x-axis, "Work items" and "Project" capitalised mid-sentence, grey disabled primary buttons (General, Saved views, Timesheet, portal Account), two create buttons on Services, no sidebar icons or counts, Settings navigation still 16 flat items.
9. **Console noise:** `email-link-handoff` 404 and `identity-links` 403 are normal states logged as errors.

## Seeder and setup findings (fixed in PR 1089)

Saved views used the wrong sort key (422 on count), customers cannot sign in on a fresh instance until customer password sign-in is enabled, the admin persona had no assignments or notifications, and KB and Pages excerpts repeated the title.

## Accessibility

axe found one minor violation: an empty table header on workspace Members. No colour-contrast violations; some elements over translucent surfaces were left "incomplete" and need a manual check.

## Limits

Phone captures are a 390 px desktop viewport without touch emulation. Feature-off captures are dark only. Lead, member and viewer were captured at desktop light only.
