# Hosted cold-recording diagnostic contract

**Status:** Internal diagnostic contract. This bounded recording is evidence for investigation; it is not a performance acceptance run and cannot establish a P0 gate as passed.

**Technical choice — 2026-10-02:** Keep the publishable report at schema v1 and version the private failure receipt when adding bounded incomplete-request classification. Derive request completion and the classification from one immutable post-detach snapshot of the production CDP event reducer. This distinguishes broad resource/source classes without adding endpoint identities, relaxing the existing completion rule, or changing the capture boundary.

## Capture and acceptance boundaries

The diagnostic records one fixed hosted cold journey using the existing canonical benchmark and its current selectors, marks, actions, fixture, network interval, budgets, clock alignment, trace checks, and report privacy validator. A diagnostic report is not a canonical benchmark result, does not change or satisfy canonical budgets, and does not imply acceptance. The diagnostic’s existing all-tracked-request clock-completion gate remains fail closed. It does not wait for extra network activity, synthesize timestamps, exclude a request, or infer a cause from an absent terminal event.

Only a privacy-validated successful report may be uploaded. Raw browser traces, CDP packets, URLs, request identifiers, headers, cookies, bodies, DOM, tenant data, arbitrary errors, and absolute clock values remain private and ephemeral. The report remains schema v1; the failure receipt is a separate private channel.

## Private failure receipt v3 (historical format)

Schema v3 is retained here to describe the immutable historical capture evidence that was emitted by the previously reviewed source. The current parser is strict schema v4 and does not accept v3 as a current receipt. A preserved v3 receipt must be interpreted only against its pinned historical validator/source; it is never rewritten, silently upgraded, or treated as having fields that v3 did not record.

In this historical format, the child wrote and the parent accepted only an exact-key JSON receipt no larger than 2 KiB. Its fixed identity was `schemaVersion: 3` and `kind: "cold-recorder-failure"`. A passed child could leave this receipt only as an ephemeral private handoff of validated counts and the post-detach snapshot; the parent deleted it with scratch. The parent emitted a receipt line only when the run failed or a later cleanup failed. Its top-level keys were exactly:

```text
schemaVersion, kind, childOutcome, primary, counts, flags, cleanup, networkClockState
```

`primary` is either `null` when no failure has occurred, or the existing closed `{ code, stage }` pair. A successful child’s receipt is an ephemeral private handoff with `primary: null` and cleanup still `not-attempted`; the parent emits it only if the overall run or parent cleanup later fails. If the child passed but a later parent operation fails, the final receipt retains `childOutcome: "passed"`, carries the fixed parent failure, and retains the same verified success evidence. `counts`, `flags`, cleanup-operation names and cleanup status values remain the existing bounded v2 contract. A receipt with unknown, additional, malformed, oversized, duplicated, or internally inconsistent fields is rejected; arbitrary child output is never relayed.

`networkClockState` is `null` when no validated post-detach snapshot is available; early child failures use this value. It is distinct from a completed snapshot whose counters are all zero. Once present, it is an exact object with these integer fields:

```text
invalidStart
terminalNotSeen
invalidTerminal
notSeenAfterResponse
incompleteAfterRedirect
unexpectedSameIdReplacement
duplicateTerminal
unmatchedTrackedEvent
```

The first three fields count current tracked entries: `invalidStart` counts a missing or malformed start timestamp; `terminalNotSeen` counts entries without a first terminal event at snapshot time; `invalidTerminal` counts a first terminal event with a missing or malformed timestamp. They may overlap for the same entry and must not be summed as disjoint categories. `notSeenAfterResponse` is a subset of `terminalNotSeen`. `incompleteAfterRedirect` counts incomplete current entries marked as a redirect replacement. The final three fields count same-ID replacement without redirect evidence, duplicate terminal events, and response/priority/terminal events whose request ID is not currently tracked. These anomaly counters are event counts and use the existing received-event bound.

Entry counts are bounded by the existing 2,048 tracked-request cap. Anomaly counts are bounded by the existing 250,000 received-event cap. The validator enforces:

- each of `invalidStart`, `terminalNotSeen`, and `invalidTerminal` is at most `counts.trackedRequests`;
- `notSeenAfterResponse` is at most `terminalNotSeen`;
- `incompleteAfterRedirect` is at most `counts.incompleteTrackedRequests`;
- `terminalNotSeen + invalidTerminal` is at most `counts.trackedRequests`, because terminal absence and malformed first-terminal timestamps are disjoint;
- with all related values known, `max(invalidStart, terminalNotSeen, invalidTerminal) <= incompleteTrackedRequests <= invalidStart + terminalNotSeen + invalidTerminal`;
- a non-null snapshot requires known tracked and incomplete request counts, with incomplete no greater than tracked.

Any anomaly counter reaching its bound fails closed through the existing integrity path; counters are never wrapped or truncated. If an incomplete interval exists, the existing `network-clock-incomplete` failure remains primary. A duplicate, unmatched terminal, or unexpected same-ID replacement cannot overwrite earlier lifecycle state or create a complete interval; when there is no incomplete interval, these integrity anomalies fail closed through the existing trace-integrity path.

The successful private handoff is stricter than a bounded failure receipt. It requires the actual fixed journey and capture success evidence: exactly three clock samples, nonzero received and retained trace counts, nonzero CPU sample and node counts, a positive tracked-request count, zero incomplete requests, and the complete success flags (`journeyAssertionsComplete`, trace/network overflow false, trace data loss false, report privacy passed). Every request-lifecycle and protocol-anomaly counter must be zero. The parent validates the handoff again and reconciles its tracked-request count with the `resources` array length of the separately privacy- and provenance-validated report before creating the caller’s output file. It also binds report trace and CPU sample counts to the handoff. A missing snapshot, zero tracked requests, incomplete interval, anomaly, missing/zero required evidence, or count mismatch rejects publication.

## Private failure receipt v4 (current format)

The current child/parent private receipt has exact top-level keys `schemaVersion`, `kind`, `childOutcome`, `primary`, `counts`, `flags`, `cleanup`, `networkClockState`, and `incompleteClassification`; its identity is `schemaVersion: 4` and `kind: "cold-recorder-failure"`. It retains the v3 `counts`, `flags`, cleanup fields, and `networkClockState` with exactly the same meanings and bounds. The strict parser accepts schema v4 only. It rejects schema v3 and any unknown, additional, malformed, oversized, duplicated, or inconsistent fields; historical v3 files are not accepted through a compatibility fallback.

`incompleteClassification` is `null` exactly when no validated post-detach snapshot exists; in that case tracked and incomplete counts and `networkClockState` are also null. For a validated snapshot it is a fixed object with exactly two fixed partitions:

```json
{
  "resourceKinds": {
    "document": 0,
    "stylesheet": 0,
    "image": 0,
    "media": 0,
    "font": 0,
    "script": 0,
    "texttrack": 0,
    "xhr": 0,
    "fetch": 0,
    "eventsource": 0,
    "websocket": 0,
    "manifest": 0,
    "signedexchange": 0,
    "ping": 0,
    "cspviolationreport": 0,
    "preflight": 0,
    "other": 0,
    "unknown": 0
  },
  "sourceClasses": {
    "verified-build-asset": 0,
    "known-fixed-route": 0,
    "same-origin-other": 0,
    "other-or-invalid": 0
  }
}
```

Every value is an integer from 0 through the existing 2,048 tracked-request bound. The sum of each partition must equal `counts.incompleteTrackedRequests`; no individual request entries or free-form labels are allowed. When the snapshot exists but has no incomplete current requests, all values are zero. A passed-child handoff requires every partition value to be zero, in addition to every existing v3 success invariant. For a failed child, the existing primary failure is preserved; classification does not change or replace it.

The reducer derives these counts from only the incomplete current hops in the same immutable post-detach snapshot that supplies `networkClockState`. The resource-kind partition uses an explicit finite mapping from the CDP Network `ResourceType` enum. Known CDP values are normalized to lowercase fixed tokens, including `Other`; absent or unrecognized values map to `unknown`. Separately, the existing report `resourceType` maps only its established lowercase report tokens; CDP values without a report token, and absent or unrecognized values, map to report `other`. Raw CDP type strings are never serialized.

The source-class partition is mutually exclusive. `verified-build-asset` means a same-origin URL whose basename is a member of the already verified current build manifest/dist inventory; a filename-shaped match alone is insufficient. `known-fixed-route` means the same-origin URL matches the existing closed safe-route matcher, and the receipt emits only this broad category, never the route template or dynamic path. `same-origin-other` means a valid URL has the capture origin but matches neither verified asset nor known route. `other-or-invalid` covers foreign origins, invalid/missing URLs, and all other unclassifiable cases. Classification may inspect private request metadata, but emits no URL, path, query, request ID, method, status, initiator, timestamp, raw type, stack, or arbitrary string.

The existing lifecycle-counter validation and all-tracked-request completion requirement remain unchanged. Both classification partition sums must equal the known incomplete count, and a non-null classification requires the same validated snapshot and known request counts as `networkClockState`. The parent validates the v4 receipt before relay and preserves its fixed primary failure; the parent still refuses to create caller output for an incomplete request. The 2 KiB byte limit, canonical JSON encoding, exact-key/duplicate-key rejection, private scratch ownership, cleanup, success evidence, report v1 validation, report-byte binding, and success-only publication remain unchanged. These categories describe observed request metadata only; they do not identify why a terminal event was absent.

## Request lifecycle and timing

The production reducer tracks only the current hop for each request ID. A request start is `valid`, `missing`, or `invalid`. The first `loadingFinished` or `loadingFailed` event sets terminal state to `valid`, `missing`, or `invalid`; before such an event the terminal is `not-seen`. A later terminal event is recorded as a duplicate and cannot replace the first timestamp or failure state. A response event records only that a response was seen.

When a new start reuses an ID with redirect evidence (`redirectResponse`), it replaces the current hop and marks the new hop as redirect-related. Reuse without redirect evidence is an integrity anomaly. The reducer never retains redirect response content in telemetry. This follows the protocol’s request-ID and redirect-event model described by the [Chrome DevTools Protocol Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

At the existing post-detach resource-build point, the recorder takes one snapshot and derives tracked and incomplete counts from it. A complete interval requires both start and first terminal timestamps to be valid. Valid timestamps continue through the existing clock translation, ordering checks, and page-relative-window validation. Missing starts, missing or invalid terminal timestamps, and terminal events not observed by detach all remain incomplete. In particular, a valid start without an observed terminal describes only what was observed by the snapshot; it does not establish why the event was absent.
