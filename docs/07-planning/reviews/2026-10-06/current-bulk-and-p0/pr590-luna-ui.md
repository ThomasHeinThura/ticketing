# PR 590 ordinary UI review — GPT-6 Luna

- **Candidate:** `32ed86f472645a2c69ea7200c1955e4787bbb1ad`
- **Base:** `75d2c97b6670e31cba41a82671e8cc7881cfc987`
- **Review context:** fresh and independent of the author; source review only.
- **Verdict:** **Request changes** — one keyboard lifecycle blocker below.

## Scope and checks actually performed

Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/04-engineering/sdlc.md`, current status and decision-log context, UX quality gate G11, accessibility focus rules, the complete four-file source diff, adjacent create-dialog/trigger components, and the supplied PR 590 body. Confirmed the local checkout is at the candidate SHA and inspected the prior implementation at the specified base.

No tests, browser session, hosted G11 run, Docker build, SQL run, or performance benchmark was executed in this review. The PR records typecheck/build/one unit test/Biome and mock-browser author checks; those are author evidence, not checks run by this reviewer. The author reports the initial-list and open-dialog PNGs were generated in the full run, but those two PNGs are absent after the focused retry rerun; the error screenshot remains. I did not inspect the missing images. No hosted performance improvement is claimed, consistent with the PR body.

## Finding

### [P2] Allow Escape to cancel while the shell chunk is loading

In `apps/web/src/routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx`, `openCreateDialog` sets the open flag but the route renders only a `role=status` loading placeholder until `loadCreateWorkItemDialog()` resolves. The actual `Dialog` is mounted only afterward in `WorkItemCreateDialogShell`. While that request is delayed, there is no dialog, close button, or Escape listener. Pressing Escape during this interval does nothing; once the request resolves, the dialog appears unexpectedly. This leaves the user unable to cancel a delayed open with the keyboard and breaks the dialog lifecycle expectation that an open modal can be dismissed and focus returned to its trigger.

The delayed-boundary E2E test holds the wrapper chunk, checks the status placeholder, releases the chunk, and only tests Escape after the form has loaded. It therefore does not cover Escape during the held-wrapper interval. Add a regression journey that presses Escape while the wrapper request is held and confirms the dialog stays closed after the request is released; make the pending-open state cancellable and ensure a late resolution cannot reopen it.

## Non-blocking observations

- The extracted shell uses `@taskdesk/ui` dialog primitives and keeps the form's existing lazy boundary.
- The route's sort/layout URL state and registered route are untouched in this diff.
- Failure recovery is explicitly documented in the PR as a page reload through the inline “Try Again” action. The mock-browser retry test follows that reload path; I found no separate source-level defect in that documented recovery behavior.
- PR body reports initial and dialog screenshots, but the first two files are currently unavailable per the orchestrator's artifact check. This is an evidence-retention gap, not a source blocker by itself.
- No exact-head hosted G11 result is present, and no G11 clearance is claimed.
