# Hosted cold-recording diagnostic contract

**Status:** Internal diagnostic contract. This bounded recording is evidence for investigation; it is not a performance acceptance run and cannot establish a P0 gate as passed.

**Technical choice — 2026-10-02:** Keep the publishable report at schema v1 and version the private failure receipt when adding network lifecycle observability. Derive request completion from one immutable post-detach snapshot of the production CDP event reducer. This makes missing event states distinguishable without adding endpoint identities, relaxing the existing completion rule, or changing the capture boundary.

## Capture and acceptance boundaries

The diagnostic records one fixed hosted cold journey using the existing canonical benchmark and its current selectors, marks, actions, fixture, network interval, budgets, clock alignment, trace checks, and report privacy validator. A diagnostic report is not a canonical benchmark result, does not change or satisfy canonical budgets, and does not imply acceptance. The diagnostic’s existing all-tracked-request clock-completion gate remains fail closed. It does not wait for extra network activity, synthesize timestamps, exclude a request, or infer a cause from an absent terminal event.

Only a privacy-validated successful report may be uploaded. Raw browser traces, CDP packets, URLs, request identifiers, headers, cookies, bodies, DOM, tenant data, arbitrary errors, and absolute clock values remain private and ephemeral. The report remains schema v1; the failure receipt is a separate private channel.

## Private failure receipt v3

The child writes and the parent accepts only an exact-key JSON receipt no larger than 2 KiB. The receipt’s fixed identity is `schemaVersion: 3` and `kind: "cold-recorder-failure"`. A passed child may leave this receipt only as an ephemeral private handoff of validated counts and the post-detach snapshot; the parent deletes it with scratch. The parent emits a receipt line only when the run fails or a later cleanup fails. Its top-level keys are exactly:

```text
schemaVersion, kind, childOutcome, primary, counts, flags, cleanup, networkClockState
```

`primary` is either `null` when the child passed its journey and report-privacy assertions, or the existing closed `{ code, stage }` pair. A successful child’s receipt is an ephemeral private handoff with cleanup still `not-attempted`; the parent emits it only if the overall run or parent cleanup later fails. `counts`, `flags`, cleanup-operation names and cleanup status values remain the existing bounded v2 contract. A receipt with unknown, additional, malformed, oversized, duplicated, or internally inconsistent fields is rejected; arbitrary child output is never relayed.

`networkClockState` is `null` until the post-detach network snapshot has been made. `null` means the snapshot was not reached; it is distinct from a completed snapshot whose counters are all zero. Once present, it is an exact object with these integer fields:

```text
invalidStart
terminalNotSeen
invalidTerminal
notSeenAfterResponse
incompleteAfterRedirect
unexpectedSameIdReplacement
duplicateTerminal
```

The first three fields count current tracked entries: `invalidStart` counts a missing or malformed start timestamp; `terminalNotSeen` counts entries without a first terminal event at snapshot time; `invalidTerminal` counts a first terminal event with a missing or malformed timestamp. They may overlap for the same entry and must not be summed as disjoint categories. `notSeenAfterResponse` is a subset of `terminalNotSeen`. `incompleteAfterRedirect` counts incomplete current entries marked as a redirect replacement. The final two fields count same-ID replacement without redirect evidence and duplicate terminal events. These anomaly counters are event counts and use the existing received-event bound.

Entry counts are bounded by the existing 2,048 tracked-request cap. Anomaly counts are bounded by the existing 250,000 received-event cap. The validator enforces:

- each of `invalidStart`, `terminalNotSeen`, and `invalidTerminal` is at most `counts.trackedRequests`;
- `notSeenAfterResponse` is at most `terminalNotSeen`;
- `incompleteAfterRedirect` is at most `counts.incompleteTrackedRequests`;
- with all related values known, `max(invalidStart, terminalNotSeen, invalidTerminal) <= incompleteTrackedRequests <= invalidStart + terminalNotSeen + invalidTerminal`;
- a non-null snapshot requires known tracked and incomplete request counts, with incomplete no greater than tracked.

Any anomaly counter reaching its bound fails closed through the existing integrity path; counters are never wrapped or truncated. If an incomplete interval exists, the existing `network-clock-incomplete` failure remains primary. A duplicate, unmatched terminal, or unexpected same-ID replacement cannot overwrite earlier lifecycle state or create a complete interval; when there is no incomplete interval, these integrity anomalies fail closed through the existing trace-integrity path.

## Request lifecycle and timing

The production reducer tracks only the current hop for each request ID. A request start is `valid`, `missing`, or `invalid`. The first `loadingFinished` or `loadingFailed` event sets terminal state to `valid`, `missing`, or `invalid`; before such an event the terminal is `not-seen`. A later terminal event is recorded as a duplicate and cannot replace the first timestamp or failure state. A response event records only that a response was seen.

When a new start reuses an ID with redirect evidence (`redirectResponse`), it replaces the current hop and marks the new hop as redirect-related. Reuse without redirect evidence is an integrity anomaly. The reducer never retains redirect response content in telemetry. This follows the protocol’s request-ID and redirect-event model described by the [Chrome DevTools Protocol Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

At the existing post-detach resource-build point, the recorder takes one snapshot and derives tracked and incomplete counts from it. A complete interval requires both start and first terminal timestamps to be valid. Valid timestamps continue through the existing clock translation, ordering checks, and page-relative-window validation. Missing starts, missing or invalid terminal timestamps, and terminal events not observed by detach all remain incomplete. In particular, a valid start without an observed terminal describes only what was observed by the snapshot; it does not establish why the event was absent.
