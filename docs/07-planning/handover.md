# Agent handover

**Snapshot: 2026-10-21.** Read `AGENTS.md` and [status.md](status.md) first.
This is a continuation snapshot, not policy, passed-test evidence or stage acceptance.
Thomas's instructions are in [decision-log.md](decision-log.md); the one living feature
plan is [plan.md](plan.md). Refresh GitHub before acting; do not restart an old conductor.

## Mission and deployment constraints

Continue the active goal: complete every P0–P4 requirement with real persisted APIs and
Kaneo's original surfaces; finish features, review the integrated product, repair findings,
deploy the reviewed artifact and prepare Thomas's SIT walkthrough. Routine recommended
technical choices and protected merges after green required checks and independent review
are authorized. No P5–P7, production deployment or bulk branch/worktree deletion.

- **OrbStack stays stopped.** Do not restart it or run local Docker/Testcontainers.
  Native preflight remains available; hosted CI supplies container/PostgreSQL evidence.
- Final origins: **https://tickting.technexus.info** and
  **https://portal.technexus.info**. The agent hostname spelling is intentional.
- DNS is configured through Cloudflare. **Keep its proxy enabled.** Do not ask Thomas
  to switch to DNS-only again.
- SSH alias **`proxy`** targets `bimdevops@4.194.153.78`. Use configured SSH access;
  never copy private keys or put credentials in repository documents.
- **Docker Compose and digest-pinned prebuilt images only** on the VM. No application
  source checkout, builds or CI workers. Record source SHA and image digest at deployment.
- **TaskDesk has not yet been deployed to that VM.** The previous local installation
  used revision `unknown`, and OrbStack is stopped. Neither proves current acceptance.
- Preserve unrelated VM services. No shared-host reboot or broad proxy changes without
  coordination. No retired PAL/9Router services. Supply seeded account secrets privately.
- No stage is complete or signed off. Only Thomas's actual SIT walkthrough closes stages.

## Accepted code and current branches

Live accepted main: `0f121c4e3c46898a840bf70e962be76a6ac5e2c3` (#885).
The primary checkout has been refreshed to it without discarding work. Do not delete other
worktrees or have two sessions edit the same file. Inspect live GitHub before continuing.

| Change | Evidence/state | Continuation |
| --- | --- | --- |
| #875 integration shards | Merged, all 18 checks. Slowest measured partition 8m43s versus former 31m22s serial step, not total pipeline time. | Preserve the fail-closed collector and required checks. |
| #877 seed; #878 recovery | Merged, all 18 checks each. Restricted-credential repeated real submissions, isolated database-row/nonempty-file restore, health and denied egress verified. | Complete remaining P0 backup/runtime/recovery acceptance. |
| #870 approval decisions | Merged after required checks/review. | Approval requests/candidates and prerequisites remain. |
| #871 canonical Kaneo work-item page/pane | Merged on reviewed bf3c6b95, all 18 checks. | Remaining P1 hierarchy/relations/project labels and integrated acceptance. |
| #881 canonical workspace labels | Merged on reviewed a871a853, all 18 checks. | Project label catalogues remain separate unfinished work. |
| [#882 canned responses](https://github.com/ThomasHeinThura/ticketing/pull/882) | **Merged** to main 2f366cd4 on reviewed ff85f0bc after all 18 checks. Hosted PostgreSQL, 138 browser tests, G8, G11 budgets 22/22 and amd64 image boot passed. | Do not reimplement its placeholders/management or repeat resolved fixture defects. Full P2/SIT acceptance remains open. |
| [#883 sidebar/project controls](https://github.com/ThomasHeinThura/ticketing/pull/883) | **Merged** to 948cc5c0 on independently reviewed 2bbfb21d after all 18 required checks. G11 22/22; G8, PostgreSQL and browser checks passed. | Preserve scoped create controls, parallel sidebar/navigation downloads and creation-form loading on intent. P1 acceptance remains open. |
| [#880 image build](https://github.com/ThomasHeinThura/ticketing/pull/880) | Candidate c3ca7047 imports accepted 948cc5c0. Authored source diff unchanged; native structural check passed. Hosted PostgreSQL/G8 passed but G11 palette timing failed at 209.3 ms > 200 ms. | Worktree ~/.codex/worktrees/taskdesk-native-artifact-image-build. Import/docs reviewed (5599889913). Diagnose retained G11 failure before another candidate; no blind rerun/merge. Actual multiarch release, scanning and signing remain unverified. |

## Immediate next work

1. Complete #880 and verify its real multiarch release. Earlier release 39548649101's
   arm64 QEMU build hung after Vite transformed 7,397 modules and reached the 35-minute
   timeout. The candidate compiles CPU-independent artifacts on the native build platform,
   with target-native production dependencies/runtime. Do not increase the timeout or
   narrow supported architectures. An amd64 image proof does not establish arm64 success.
2. Continue [#884 project catalogues](https://github.com/ThomasHeinThura/ticketing/pull/884)
   in ~/.codex/worktrees/taskdesk-project-label-catalogues, branch codex/project-label-catalogues. Candidate migration 0126 adds label.project_id
   with a composite workspace/project FK and per-catalogue uniqueness. Dedicated typed
   routes enforce current project reach and strict label:manage; legacy label routes
   exclude project entries. Assignments accept workspace/own-project labels only; deletion
   journals removals and advances affected item versions. Backend security review is clean;
   884 API unit tests, 107 permission checks and API/web typechecks passed. UI reuses the
   Kaneo label catalogue with URL-addressed dialogs and a strict manageLabels flag.
   UI/security review is clean. Six native browser journeys and 53 URL/navigation tests
   passed, including reload CRUD, strict management grants, late-response draft preservation,
   retry, mobile/dark/reduced-motion and workspace regression. Logs are
   /tmp/taskdesk-project-labels-browser-4.log and /tmp/taskdesk-project-labels-url-nav-unit.log.
   Finish real PostgreSQL migration/concurrency/permission and actual API browser journeys,
   Linux visual baseline inspection and all required CI. New PG tests are authored, not run.
   It is not merged, deployed or accepted. Preserve its local work when refreshing main.
3. Continue the full P1 then P2–P4 sequence in the living plan. Hierarchy has parent/tree
   backend code but a 500-node cap with truncation; per-parent pagination (#434), inline
   hierarchy UI and full lifecycle behavior remain. Canonical relations remain unbuilt;
   legacy task relations do not satisfy them. Audit actual code before marking rules done.

Final #883 evidence: fast 39599615279 / full 39599615196, independent review
5599615060, completion comment 6316212513. G11 22/22: 500-row render 425.8 ms,
palette open 107.6 ms, keyboard navigation 136.5 ms. Native delta: 13 unit and eight
browser journeys. Earlier 2c4a1102/fde5bcbc G11 failures remain adverse evidence in
#876/#711. The final non-gating CPU diagnostic still fails: signed negative V8 deltas
are rejected and assignment clock alignment is incomplete. Do not claim complete CPU
attribution. Logs: /tmp/taskdesk-sidebar-2bb-g11.log; older raw palette capture:
/tmp/taskdesk-sidebar-fde-diagnostic. No budgets, calibration, retries or required checks
were relaxed. These are change-level results, not stage/SIT acceptance.

## Accepted canned-response evidence

CA19/20 management uses the existing Kaneo settings shell and rich-text editor. Manager
listing is settings-permission scoped; composer listing remains item-reach/API-key scoped.
Tokens requester.name, work_item.key and work_item.due_date are expanded as literal text
only, including split formatting; attributes/URLs and stored templates stay unchanged.
Insertion fetches fresh authorized item context and locks editing/sending while pending.
Failed/removed templates preserve drafts for retry. Requester contacts need no workspace
user membership; only the item-linked display name (linked-user fallback), never email,
is exposed. The real browser journey edits due date while the composer remains mounted,
inserts the new value, edits and sends a durable comment without automatic submission.

Review chain: source/security, intended Linux baseline, interpolation/cache repair, retry
synchronization and genuine-role/response-evidence fixtures approved through ff85f0bc.
Final proof comment: [#882 completion evidence](https://github.com/ThomasHeinThura/ticketing/pull/882#issuecomment-6311935923).
Image proof is /tmp/taskdesk-canned-ff-image-proof/taskdesk-image-proof-39570330868-1.json:
amd64 image ID sha256:5c69cf827efed939b8018d3a1d01407e7f7e3928feeb19e27adf7386151e247e,
all 126 migrations, live/ready 200, runtime UID 10001, isolated owned network and cleanup.
This candidate image is not a released multiarch artifact or final SIT deployment.
The non-gating CPU diagnostic still lacks complete sampled-frame evidence; do not call
that diagnostic passed merely because G11 budgets passed.

## Hosted integration and remaining scope

The read-only VM assessment found 2 vCPUs, 7.7 GiB RAM and 166 GiB free: suitable for light
functional SIT, not reference performance acceptance. Traefik uses network web and resolver
le; the stock overlay assumes proxy/letsencrypt and an absent file middleware. Prepare and
review a compatible isolated Compose overlay. Validate Cloudflare/origin TLS and trusted
forwarded-client-IP handling; do not guess a hop count. Keep database/cache/application
ports unpublished. Do not opt into Watchtower replacement. No remote application changes
have been made. OrbStack remains stopped and its local data is retained.

P0 still needs backup encryption/offsite/retention/runtime records and full restore walkthrough.
P1 needs complete hierarchy/relations, project labels and remaining work/view acceptance.
P2 needs teams/CAB/custom fields, approval requests, complete authoring/SLA/workflow journeys,
audit and delivery planning. P3 needs the full host-root portal, admission contracts and
implementation, identity administration and all 25 real-Entra tests (tenant access must be
established for that verification). P4 needs governance APIs/UI, full notification runtime,
automations, God Mode, MCP/API keys and #580 repository query ownership with a genuine gate.
The approved evaluator failure policy is 24 hours, then stop automatic evaluation, expose
the failure administratively and support explicit retry. #626 manual obligations remain.
The full numbered-requirement map is still incomplete; do not invent percentages.

After features: comprehensive integrated/security/Kaneo review, real agent/portal journeys,
installation/upgrade/image health, isolated backup/restore, exact SHA/digest deployment,
developer walkthrough and private test accounts. Report implemented/verified/blocked/awaiting
Thomas's sign-off separately. Missing external evidence never manufactures completion.

Latest #880 failure: fast 39602448809 / full 39602448792, G11 job 119230093551.
Palette normalised retry median 209.3 ms (budget <200); keyboard navigation 163.6 ms
passed. Log /tmp/taskdesk-image-c3ca-g11.log; sanitized diagnostic retained in
/tmp/taskdesk-image-c3ca-diagnostic. CPU profiles remain empty due parser rejection.
Do not turn this failure into a merge clearance, budget increase or blind workflow rerun.

#884 first hosted candidate 34bea894: contract caught ambiguous legacy/new paths; use
/api/label/project/{projectId}/catalogue[/{id}] consistently in route/client/policy/spec.
Local contract, 107 permission checks, six browser journeys and API/web typechecks pass
for that repair. Five Linux baselines (project labels/general/states/danger/members) are
from actual run39605343376; reviewer inspected the new catalogue and navigation-only
changes. Native all-unit tasks passed (API884, web1434), all nine typecheck tasks passed.
Hosted PostgreSQL exposed two old task-label insert-select projections lacking the new
nullable project_id; both now explicitly select NULL, with original scope predicates.
Independent review also found a legacy bulk lookup treating project catalogues as workspace
labels; it now excludes project_id and a positive-control/hidden-source negative bulk-route
regression is authored. Affected actual bulk/repository/race tests must pass before merge. Logs:
/tmp/taskdesk-project-labels-34-pg1.log and -pg2.log. Static job failed Chromium download
DNS resolution, not source lint. Record new-head results; never manufacture clearance.

[#885 sampled CPU timestamp repair](https://github.com/ThomasHeinThura/ticketing/pull/885)
is separate, worktree ~/.codex/worktrees/taskdesk-profile-sample-timestamps, branch
codex/profile-sample-timestamps, reviewed head5e201dbe. Reconstruct signed deltas across
chunks, globally sort observed points after capture, omit ambiguous intervals/tails.
Twenty native unit checks, web typecheck/build and both native source-bound captures
passed; palette retained one profile with 2,137 intervals. Exact-head review5600302361.
Hosted CPU attribution, alignment and G11 remain required. This is diagnostic evidence,
not a fix claim for #880's timing or multiarch release. Logs:
/tmp/taskdesk-profile-clock-full-diagnostic.log and -native-diagnostic-2.log.

#885 is now merged after all 18 required checks passed on reviewed5e201dbe. Hosted
G11 passed22/22 (palette107.5ms, keyboard146.3ms) and BOTH source-bound diagnostics
passed2/2 with sampled CPU frames. Completion comment6317320475, review5600302361;
fast39607995767/full39606695230. Retained hosted diagnostic:
/tmp/taskdesk-profile-clock-5e-hosted (independent palette:1profile/3575intervals).
Do not reuse older empty-profile artifacts as the new result. #880 imported accepted
main on14d45e14 with its original3-file authored diff byte-identical and native structural
probe/dependency checks passing. Import/docs review and exact-head CI remain required.
#884 remains reviewed329cfe36 with repairs; current-head CI is not yet merge clearance.
