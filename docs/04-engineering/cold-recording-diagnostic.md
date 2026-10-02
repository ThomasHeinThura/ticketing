# Hosted cold-recording diagnostic contract

**Status:** Internal diagnostic contract. This bounded recording is evidence for investigation; it is not a performance acceptance run and cannot establish a P0 gate as passed.

**Technical choice — 2026-10-02:** Keep the publishable report at schema v1 and version the private failure receipt as bounded diagnostic evidence evolves. Derive request completion and classification from one immutable post-detach snapshot of the production CDP event reducer. A failure-only phase census, when its independent prerequisites validate, reports only fixed exclusive phase categories in the already observed LCP and route-start-to-paint windows. It adds no endpoint identity, causal claim, acceptance signal, or capture-boundary change.

## Capture and acceptance boundaries

The diagnostic records one fixed hosted cold journey using the existing canonical benchmark and its current selectors, marks, actions, fixture, network interval, budgets, clock alignment, trace checks, and report privacy validator. A diagnostic report is not a canonical benchmark result, does not change or satisfy canonical budgets, and does not imply acceptance. The diagnostic’s existing all-tracked-request clock-completion gate remains fail closed. It does not wait for extra network activity, synthesize timestamps, exclude a request, or infer a cause from an absent terminal event.

Only a privacy-validated successful report may be uploaded. Raw browser traces, CDP packets, URLs, request identifiers, headers, cookies, bodies, DOM, tenant data, arbitrary errors, and absolute clock values remain private and ephemeral. The report remains schema v1; the failure receipt is a separate private channel.

## Private failure receipt v3 (historical format)

Schema v3 is retained here to describe the immutable historical capture evidence that was emitted by its reviewed source. The source pinned to v3 accepted schema v3 only. A preserved v3 receipt must be interpreted only against its pinned historical validator/source; it is never rewritten, silently upgraded, or treated as having fields that v3 did not record.

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

## Private failure receipt v4 (historical format)

The historical v4 child/parent private receipt had exact top-level keys `schemaVersion`, `kind`, `childOutcome`, `primary`, `counts`, `flags`, `cleanup`, `networkClockState`, and `incompleteClassification`; its identity was `schemaVersion: 4` and `kind: "cold-recorder-failure"`. It retained the v3 `counts`, `flags`, cleanup fields, and `networkClockState` with exactly the same meanings and bounds. The source pinned to v4 accepted schema v4 only and rejected schema v3 and any unknown, additional, malformed, oversized, duplicated, or inconsistent fields. Historical v3/v4 files are interpreted only against their pinned historical validator; no compatibility fallback upgrades them.

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


The existing lifecycle-counter validation and all-tracked-request completion requirement remained unchanged. Both classification partition sums equaled the known incomplete count, and a non-null classification required the same validated snapshot and known request counts as `networkClockState`. The parent validated the v4 receipt before relay and preserved its fixed primary failure; it refused caller output for an incomplete request. These categories described observed request metadata only; they did not identify why a terminal event was absent.

## Private failure receipt v5 (current format)

The current private child/parent receipt uses exact top-level keys `schemaVersion`, `kind`, `childOutcome`, `primary`, `counts`, `flags`, `cleanup`, `networkClockState`, `incompleteClassification`, and `phaseCensus`, with `schemaVersion: 5` and `kind: "cold-recorder-failure"`. It preserves v4 fields and meanings. The parser is strict v5: it rejects v3/v4, duplicate keys, noncanonical encodings, additional fields, malformed values, and any serialized receipt above 2 KiB. Historical receipts are read only under their pinned historical validator and are never rewritten as v5.

`phaseCensus` is an exact object with keys `state` and `windows`. `state` is one of `unavailable`, `not-validated`, or `validated`. `windows` is `null` for the first two states. `unavailable` means required trace/clock evidence or access to that evidence was not available. `not-validated` means the network-incomplete failure path attempted independent phase derivation or validation, but its prerequisites or result did not validate. Neither state contains numbers. A passed-child handoff always carries `{"state":"unavailable","windows":null}`; it is not another success gate and does not supersede report v1.

A `validated` census is allowed only for a failed child whose unchanged primary is `{code:"network-clock-incomplete",stage:"network"}`; it requires exactly three clock samples, positive bounded received/retained trace and CPU sample/node counts, `journeyAssertionsComplete:true`, `traceOverflow:false`, `networkOverflow:false`, `traceDataLoss:false`, and a validated immutable network snapshot with a positive incomplete tracked-request count. It is failure evidence, never success evidence. If any required evidence is missing or inconsistent, preserve `network-clock-incomplete` as primary and emit only `not-validated` (or `unavailable` when the prerequisite evidence itself was unavailable). A census failure must not replace that primary. Existing ownership, receipt validation, and success-only report publication remain fail closed.

The validated `windows` object has exactly `lcp` and `clickToPaint`. Each is an exact object with the six fixed exclusive categories `main-thread-idle`, `main-thread-other`, `parse-evaluate`, `react-render-commit`, `dom-removal`, and `paint-layout`. Each value is a nonnegative integer deci-millisecond count (tenths of a millisecond), bounded at 6,000,000. The fixed windows are `[0, observedLcpMs]` and `[observedRouteStartMs, observedRouteStartMs + observedRoutePaintDurationMs]`; marks must be finite, within the existing page-relative 0..600,000 ms domain, and bound to the actual observed journey values before serialization. Values use the successful `windowPhaseTotals` clipping and rounding semantics. For each window, the sum of category values may not exceed its observed duration plus the documented maximum six-category rounding allowance of 6 deci-ms.

The census reuses the main-thread marker and exclusive phase derivation. Source segments must be finite, sorted, non-overlapping, in the page-relative domain, and bounded by the existing 100,000-segment maximum; each raw source interval must have positive width before any quantization, and derivation requires a RunTask overlapping the fixed journey. The failure-only path retains translated segment precision through clipping, then rounds each category aggregate to deci-ms. A positive interval is valid even if rounding its two endpoints independently would collapse it to zero width. The successful report-v1 segment quantization and rounding semantics remain unchanged. The census emits only the six categories and integer counts. It does not emit segments, CPU stacks, function names, source/module attribution, script URLs, request IDs, paths, symbols, timestamps, or arbitrary labels. It never adds resource intervals, CPU samples, or request/idle overlap to phase totals and does not infer an idle tail after the last observed RunTask. A phase category is a temporal classification, not CPU stack attribution, a network-wait boundary, a cause, or proof that a font caused a budget miss.

The current v5 receipt remains within the existing 2 KiB canonical JSON cap, including maximum bounded counts and the maximum-size validated census; implementation tests must serialize that worst-case valid receipt and prove the bound. Every parent construction path supplies the field. Parent relay validates the closed schema, byte cap, state/primary/count/flag coherence, and census bounds; it cannot reconstruct raw phase evidence and does not claim to. The parent still refuses to create caller output for any incomplete request or invalid/tampered receipt. Report v1 privacy/provenance validation, exact-byte binding, cleanup ownership, the existing all-tracked-request completion gate, canonical marks/actions/fixture/budgets, and success-only upload remain unchanged.

The census is available only on the existing failure path after profiler/tracing stop, `tracingComplete`, CDP detach, immutable request snapshot, trace/network integrity checks, and three-sample/document-origin clock validation, before throwing the unchanged network-incomplete primary. There is no extra network drain, wait, retry, preload, warm-up, synthetic terminal, request dropping/exclusion, or capture-boundary shift. A successful capture follows the same report v1 validation and upload path; its receipt phase census remains unavailable.

## Request lifecycle and timing

The production reducer tracks only the current hop for each request ID. A request start is `valid`, `missing`, or `invalid`. The first `loadingFinished` or `loadingFailed` event sets terminal state to `valid`, `missing`, or `invalid`; before such an event the terminal is `not-seen`. A later terminal event is recorded as a duplicate and cannot replace the first timestamp or failure state. A response event records only that a response was seen.

When a new start reuses an ID with redirect evidence (`redirectResponse`), it replaces the current hop and marks the new hop as redirect-related. Reuse without redirect evidence is an integrity anomaly. The reducer never retains redirect response content in telemetry. This follows the protocol’s request-ID and redirect-event model described by the [Chrome DevTools Protocol Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

At the existing post-detach resource-build point, the recorder takes one snapshot and derives tracked and incomplete counts from it. A complete interval requires both start and first terminal timestamps to be valid. Valid timestamps continue through the existing clock translation, ordering checks, and page-relative-window validation. Missing starts, missing or invalid terminal timestamps, and terminal events not observed by detach all remain incomplete. In particular, a valid start without an observed terminal describes only what was observed by the snapshot; it does not establish why the event was absent.
