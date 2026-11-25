---
title: Agent guide
---

# Agent guide

The agent app is where staff work. It lives on the agent host and opens at `/agent`. What you see depends on your role and on which features an administrator has switched on. If a screen or section is missing, ask an administrator whether the feature flag is on (see [Administration](administration.md)).

## Home, My work and inbox

- Home (`/agent`) is the landing page, and `/agent/dashboard` is a dashboard you can edit.
- My work (`/agent/my-work`) lists what is assigned to you, including approvals waiting for your decision.
- Inbox (`/agent/inbox`) holds in-app notifications.
- Search (`/agent/search`) and the command palette search work items you can reach.
- Views (`/agent/views`) are saved queries. A private view is visible to you only. Sharing with a team or the workspace needs the matching capability.

## Projects

Projects are listed under `/agent/projects`. Each project has a short key, and its work items are numbered with it, such as `PROJ-12`. A project page has these tabs:

| Tab | Purpose |
| --- | --- |
| Work | The main list, with list, board and table layouts over the same records |
| Backlog | Items not yet scheduled, ranked by drag and drop |
| Calendar, Timeline | Dated views of the same items |
| Cycles, Modules | Timeboxes and larger goals, when those features are on |
| Pages, Documents | Staff-only pages and linked documents |
| Team, Prerequisites | Project roster and what the project is waiting for |
| Settings | Members, states, labels, estimates, budget, features, automations and the danger zone |

Filters, sorting and grouping are kept in the URL, so you can share a link to a filtered view.

## Work items

Open an item at `/agent/work-items/<KEY>`, or in the side pane from the list. An item has a title, description, priority, assignee, dates, labels and custom fields. It also holds sub-tasks, relations such as blockers and dependencies, comments, attachments and activity.

Comments are public (the customer sees them) or internal. Edits use versions, so if someone else changed the item first you get a conflict notice instead of a silent overwrite. Moving an item between states follows the project workflow, which can require a note or an approval.

Deleting an item, comment, attachment or project opens a pending action. You approve it yourself under Account, Pending actions, and nothing is deleted until you do.

## Triage

Requests from the portal arrive at Triage (`/agent/triage`) when the intake feature is on. The queue shows reference, customer, organisation, request type, summary and age, plus suggested duplicates. You can:

- accept the request, which creates a work item. You choose the project and confirm the type, and both are pre-filled from the request type;
- decline it;
- merge it into an existing work item as a duplicate;
- ask the customer for clarification.

Form answers map onto work item fields according to the request type. Anything unmapped goes into the description under a heading. You only see and link to projects you can reach.

## Time tracking

With time tracking on, each work item has a time section where you log minutes manually or start and stop a timer. The weekly timesheet is at `/agent/timesheet`. Administrators define time activities, and whether they are billable, under Settings, Workspace. Rates and project budgets appear when cost tracking is on.

## Approvals

With approvals on, a staff member with the request capability asks a named person to approve a work item from its approvals section. Customer approvals go to a contact and CAB approvals go to a change board member for change items. The approver decides from the work item or from My work. Rejecting needs a note. Nobody can approve their own request. A workflow transition marked as requiring approval stays blocked until a matching approval is granted, and each approval authorises one run of the transition. Requests expire after the default set in God Mode, General, which a request may shorten or extend up to 90 days. The requester can withdraw a pending request.

## Reports

With reports on, `/agent/reports` lists fixed reports on SLA, customers, delivery, people and leadership. Each states its scope and time window. Open a report for a table with drill-down and CSV export. `/agent/reports/new` builds a custom report, and exports appear under `/agent/reports/exports/<id>`. You only see data in your reach, and cost data needs its own capability.

## Knowledge base

With the knowledge base on, `/agent/kb` lists articles in the states draft, in review, published and archived. Each save creates a version you can restore. Published articles appear in the portal and can be suggested to customers while they write a request.

## Service management

`/agent/service-management` holds services, changes, releases and announcements when those features are on. Services record an owner, support level and dependencies. Changes carry risk, a window and a rollback plan. Releases group changes and can publish release notes to the portal.
