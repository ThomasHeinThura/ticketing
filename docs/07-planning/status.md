# Status

**Updated:** 2026-10-22. Accepted main last observed at `a99483a7` (#887).
The Antigravity SIT batch is branch `feat/batch1-hierarchy-and-parent-editing`,
head `90973b7e`. It has not established full P0–P4 completion or final integrated acceptance.

| Stage | Evidence-backed state | Remaining work |
| --- | --- | --- |
| P0 | Stack is deployed and healthy; delivery verification incomplete | Runtime-only Compose and the current digest pin are in place. Replace unknown source revision with a reviewed/verifiable artifact; finish encrypted/offsite backup and recovery evidence. |
| P1 | Core work, labels, hierarchy and parent editing exist | Restore original Kaneo navigation and calendar/timeline against canonical work items; finish relations and remaining numbered requirements; exercise all surfaces. |
| P2 | Intake and several service-desk capabilities exist | Full approval requests/authoring, teams/CAB/custom fields, workflow/SLA/calendar editors and runtime/escalation journeys require requirement-level verification and completion. |
| P3 | Catalogue, submissions and a request list exist | Shared shell/home/navigation, full request paging, customer approvals/projects/account, admission and identity administration; all 25 real Entra tests. |
| P4 | Some governance APIs and settings exist | Complete governance/God Mode, notifications, automations, webhook/MCP/API-key obligations and #580 query ownership. |

**No stage is complete.** Missing implementation is separate from Thomas's final walkthrough.
The earlier completion percentages and “walkthrough ready” claims were not supported by a
requirement-level integrated audit and are withdrawn.

## Live SIT audit

- Agent: `https://tickting.technexus.info`; customer: `https://portal.technexus.info`.
- OrbStack remains stopped; Cloudflare proxy remains enabled.
- VM read-only inspection found healthy TaskDesk, PostgreSQL and Valkey containers.
- The initial image configuration was mutable `ghcr.io/thomasheinthura/taskdesk:sit`;
  image ID/digest observed: `sha256:8ba4fdc714c7161e0e70c3732e0ab316f7e978a2514712a13ec3ed8911acaf1f`.
  The running application was then recreated with that exact digest pin and passed health.
  OCI source revision is still `unknown`, so it cannot establish a reviewed deployed SHA.
- Runtime Compose/configuration now live at `/home/bimdevops/taskdesk-sit`.
  The old source checkout was removed only after a private recovery archive was downloaded
  and verified. Named data volumes were preserved; application health passed after recreation.
  There are no application source builds or test workers on the VM.
- No application ports are published to the VM host; Traefik serves both origins.
- Four exposed SIT passwords were rotated and five sessions revoked on 22 October.
  Replacements are stored outside Git in Thomas's private local credentials file.
  Staff login succeeded after recreation. The customer browser session verified real
  submission/reply persistence; a later repeated customer login received rate-limit 429,
  not an authentication pass. Keep rate limiting enabled and respect its retry window.
  Do not republish passwords or rerun a seed that restores known credentials.
- Browser inspection confirms the agent sidebar/inset still exists, but canonical work
  navigation omits inherited calendar/timeline surfaces. Those routes still read legacy
  tasks; restoring links alone would omit canonical work items.
- Portal has no shared navigation in the deployed batch; customer approvals, projects
  and account screens are absent. The new request list truncates after its first page.
- The live customer browser walkthrough created private request `SUB-4`, verified it in
  the request list, and posted a public reply to accepted `SUB-3` that survived reload.
  Accepted requests lack upload controls. The complete all-screen walkthrough remains open.
- A live computed-style check found `max-w-3xl` present in the DOM but absent from built
  CSS (`max-width: none`). Explicit application-source scanning restores the missing
  width/type utilities in new builds. The UI repair is not deployed yet.

## Current work

One integration repair batch in `fix/sit-kaneo-integration`, isolated from the original
checkout's uncommitted changes. Restore Kaneo surfaces, complete real portal journeys,
repair deployment/security findings, test the integrated result and obtain one standard
review plus one security review. No AIDLC process or micro-review paperwork.

The active scope remains all P0–P4 requirements in [plan.md](plan.md). P5–P7 new capability
work and production deployment remain outside scope; restoring inherited Kaneo functions
was explicitly requested on 22 October. Real Entra credentials remain an external
verification dependency. Only Thomas can give the final SIT sign-off after developer testing.

## Repair evidence (development branch, not final acceptance)

- Web unit suite: 1,486 passed after identity-cache repairs; API unit suite: 902 passed.
  Permission suite: 107 passed on the earlier repair. Web/API typechecks, locale parity
  and API compatibility checks passed. Independent review reran 36 focused regressions.
- Production CSS contrast: all 428 existing pairs passed with original thresholds;
  current initial bundles are 243.5 KB agent, 298.8 KB work-list and 189.3 KB portal
  against unchanged 350/350/200 KB budgets. Initial-byte checks are not timed LCP proof.
- PostgreSQL over an SSH-only connection to isolated `taskdesk_kaneo_alignment_test`:
  87/89 broader tests passed; two WAN test/hook timeouts remain adverse evidence.
  A focused follow-up verified three selected seed/label tests, including private
  credential persistence and the new real label projection. This does not replace the
  two unpassed tests or the required hosted CI.
- One aggregate standard/security review identified seed delivery, filter/label/version
  defects and a cross-customer cache exposure during reauthentication. These are repaired;
  both source reviews approve the inspected repair. Portal queries are identity-scoped,
  local state remounts on identity changes, and all successful sign-in methods clear cache.
  Exact commit binding and hosted/runtime verification remain required.
- Four new screen fixtures reach expected content; Linux baselines are missing and G8
  remains failed. CI now captures unapproved baseline candidates after failure, in a
  separate output directory, preserving original diffs/traces and the failed gate.
  Structural diagnostic regressions passed; no baseline is automatically accepted.
- Reviewed Linux baselines, full browser coverage, performance, exact image
  build/source verification and final reviewed deployment remain open. Draft PR #889
  holds the repair; batch further fixes and evidence before another push.

## Additional live screen inspection

The current deployed agent retains Kaneo's main sidebar and workspace settings shell.
Roles, general settings and the service-calendar editor were opened. Calendar windows,
timezone, holidays/import and server preview controls exist; presets, cloning and country
holidays explicitly remain unavailable. These observations correct the pasted claim that
the entire editor is missing; they do not prove its complete specification or save behavior.

## First hosted repair run — PR #889

Head `f335fdfa`, source review bound to `109e3a73`. Fast CI passed build, unit/component,
static, route policies, contract, secret scan, gates and PR/security metadata. It failed
a stale documentation anchor (fixed locally) and a newly published critical Storybook
advisory (matched 10.6.2 patch applied locally; high/critical audit now zero; Storybook build
passes). Remaining low advisory is still reported.

Full run `39658149244`: PostgreSQL shards 1/2/4 and accessibility passed. Shard 3 had
777 passes and one test-harness BigInt serialization failure; the comparison now uses
actual row equality and its real isolated-PostgreSQL regression passes. Browser suite had
157 passes and two ambiguous header/sidebar button-name failures; seven affected sidebar
cases now pass. G8 first captured 28/32 screens, exposing duplicate realtime banners;
source now assigns exactly one native owner per canonical page. Five Linux candidates
were independently viewed and approved; approvals/audit/backlog and corrected project
headers still require fresh capture and review.

G11 measured 590.8 ms render and 4108.2 ms LCP, exceeding unchanged 500/2500 ms limits.
The project frame was remounting content as its context arrived; it now stays mounted
and its UI chunk preloads during the session check (browser regression passed). This
is a repair hypothesis requiring hosted measurement. Native G11 calibration failed
closed because this laptop's 0.532 speed factor is outside the accepted range; it is
not a performance pass and no budget/calibration change is authorized or applied.

A separate live proxy defect is confirmed: new session IPs contain a private Docker
address, not the same browser's Cloudflare trace address. Shared Traefik has no trusted
forwarding configuration; its established TLS sockets do see Cloudflare peers. The
SIT overlay's two-hop assumption is unverified and incorrect for attribution. Keep
Cloudflare enabled; repair TaskDesk-specific normalization without changing unrelated
shared proxy routes. Do not claim rate-limit/API-key IP behavior verified yet.

The TaskDesk-only normalization candidate has independent standard/security source approval.
Pinned Nginx 1.30.6 runs as UID 101 with read-only filesystem, dropped capabilities and no
published ports. On the VM, syntax and real application readiness passed; valid IPv4/IPv6
headers from the actual Traefik socket were accepted, absent/malformed headers and an
untrusted socket's forged header were rejected with 400. Merged Compose isolates the
application to its private network. The unlabeled candidate was removed; live routing is
unchanged. Runtime DNS recovery, actual browser/session attribution, Cloudflare/origin
forgery, uploads and WebSockets remain unverified.

Post-CI native preflight: production build, web typecheck, lint, environment/policy
checks and all 428 unchanged contrast thresholds pass. All 47 screen fixtures reached
their screenshot assertions; each stops only on the intentionally absent macOS baseline.
This is a functional fixture check, not a G8 pass. The two new Linux approval/audit
baselines are still missing; all other affected captures need independent visual review.
Initial gzip graphs remain 243.6/299.0/189.3 KB under 350/350/200 KB.

## Second hosted repair run — PR #889

Head `3a863039`, source review bound to `a3bc0cc5`. Full run `39663444383`:
all 47 pinned-Linux screen captures passed in the diagnostic; seven changed/new images
were independently viewed and approved, then committed for a real G8 comparison. This
capture is not a G8 pass. Accessibility found the calendar scroll region was not keyboard
focusable. The existing `packages/ui` ScrollArea fixes it; all seven project accessibility browser cases
pass locally and the source delta has independent standard/security approval.

G11 failed before product measurements: throttled calibration spread 0.765 exceeded the
unchanged 0.55 bound, leaving 21 tests unrun. This is neither a timed performance pass nor
evidence that earlier render/LCP failures are resolved. Preserve the failure and require
valid hosted measurements on the final source; do not blindly rerun or weaken calibration.

All four hosted PostgreSQL shards pass on this second run. Native final calendar checks
include actual ArrowDown scrolling, axe, typecheck and lint. All 428 contrast pairs pass
with their original semantics/thresholds; only four occurrence bindings follow the new
ScrollArea wrapper. Hosted browser/deployment evidence is still pending final disposition.
