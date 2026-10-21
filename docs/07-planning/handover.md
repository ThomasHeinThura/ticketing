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

Live accepted main: `f7a247325844b865050917f11cfaf637e0ad58a1` (#884).
The primary checkout has been refreshed to it without discarding work. Do not delete other
worktrees or have two sessions edit the same file. Inspect live GitHub before continuing.

| Change | Evidence/state | Continuation |
| --- | --- | --- |
| #875 integration shards | Merged, all 18 checks. Slowest measured partition 8m43s versus former 31m22s serial step, not total pipeline time. | Preserve the fail-closed collector and required checks. |
| #877 seed; #878 recovery | Merged, all 18 checks each. Restricted-credential repeated real submissions, isolated database-row/nonempty-file restore, health and denied egress verified. | Complete remaining P0 backup/runtime/recovery acceptance. |
| #870 approval decisions | Merged after required checks/review. | Approval requests/candidates and prerequisites remain. |
| #871 canonical Kaneo work-item page/pane | Merged on reviewed bf3c6b95, all 18 checks. | Remaining P1 hierarchy/relations and integrated acceptance. |
| #881 canonical workspace labels | Merged on reviewed a871a853, all 18 checks. | Project label catalogues merged in #884. |
| [#882 canned responses](https://github.com/ThomasHeinThura/ticketing/pull/882) | **Merged** to main 2f366cd4 on reviewed ff85f0bc after all 18 checks. Hosted PostgreSQL, 138 browser tests, G8, G11 budgets 22/22 and amd64 image boot passed. | Do not reimplement its placeholders/management or repeat resolved fixture defects. Full P2/SIT acceptance remains open. |
| [#883 sidebar/project controls](https://github.com/ThomasHeinThura/ticketing/pull/883) | **Merged** to 948cc5c0 on independently reviewed 2bbfb21d after all 18 required checks. G11 22/22; G8, PostgreSQL and browser checks passed. | Preserve scoped create controls, parallel sidebar/navigation downloads and creation-form loading on intent. P1 acceptance remains open. |
| [#880 image build](https://github.com/ThomasHeinThura/ticketing/pull/880) | Reviewed candidate046e4964 imports accepted0f121c4e. 17/18 checks; G11 palette243.2ms failed. | ~/.codex/worktrees/taskdesk-native-artifact-image-build. Import accepted #886 after its checks/merge; keep authored Dockerfile/structural-test delta. Actual multiarch release/scan/sign remains required. |
| [#884 project catalogues](https://github.com/ThomasHeinThura/ticketing/pull/884) | Merged to f7a24732 on reviewed94eb6795 after18/18 required checks, PG, real browser, G8, contrast418/418, G11 22/22 and both CPU diagnostics. | Preserve project scope, strict manageLabels, legacy isolation and URL dialogs. Full P1/SIT acceptance remains. |
| [#886 palette measurement](https://github.com/ThomasHeinThura/ticketing/pull/886) | Independent source/method/security approval on b6bb56c9; accepted #884 import and documentation update in progress. | ~/.codex/worktrees/taskdesk-palette-measurement, codex/palette-measurement. Bind review/checks to final head; see evidence below. |

## Immediate next work

1. Complete #880 and verify its real multiarch release. Earlier release 39548649101's
   arm64 QEMU build hung after Vite transformed 7,397 modules and reached the 35-minute
   timeout. The candidate compiles CPU-independent artifacts on the native build platform,
   with target-native production dependencies/runtime. Do not increase the timeout or
   narrow supported architectures. An amd64 image proof does not establish arm64 success.
2. Finish #886 final-head checks/review after accepted #884 import. Wait for the canonical
   paint recorder before running the same Playwright dialog visibility/focus assertions.
   Do not change the recorder, fixture, calibration, samples, retries or budget. Then import
   accepted code into #880, review the preserved delta and run its required checks.
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
P1 needs complete hierarchy/relations and remaining work/view acceptance.
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

## Latest evidence and adverse history

#880 reviewed046e4964: fast39609943696/full39609943861; G11job119255890231 failed
palette retry median243.2ms against200ms, keyboard144ms passed. Other17required checks
passed. Log /tmp/taskdesk-image-046-g11.log, sampled palette artifact
/tmp/taskdesk-image-046-diagnostic. Assignment diagnostic failed clock alignment; independent
palette diagnostic retained valid samples. Do not call the multiarch release fixed yet.

#884 final reviewed94eb6795: fast39613713781/full39613713595, independent review
6318052802, mergef7a24732. All18required checks passed; G11job119269017772 passed22/22,
palette retry103.0ms, navigation167.3ms, both independent CPU diagnostics2/2. Log
/tmp/taskdesk-project-labels-final-g11.log. Earlier34bea894 path ambiguity, two legacy
insert-select projections and hidden project catalogue bulk lookup were repaired; the
329cfe36 contrast-only failure was repaired by12source occurrence groups and explicit
existing bg-card backdrop, preserving418pairs/thresholds. Initial download DNS warnings
recovered and were not the static failure. Five intended Linux baselines were reviewed;
final G8 passed. These are change-level results, not stage acceptance.

#885 merged0f121c4e after18required checks, review5600302361, G11 22/22 and both hosted
CPU diagnostics2/2. Signed V8 timestamps reconstruct in arrival order, globally sort after
capture, and attribute only observed adjacent intervals. Do not reinstate nonnegative-delta
rejection, clamping or extrapolation. Older #882/#883 captures above remain historical
failures; they do not describe the current parser.

#886 independently reviewedb6bb56c9 corrects observer interference. Reviewer reconstructed
91.193ms sampled Playwright role-query work inside the hosted261.3ms interval and38.615ms
inside a native156.1ms interval. Corrected native diagnostic passed with0ms sampled role-query
work; raw208.6ms is not a controlled speed-improvement proof. Agent build, webtypecheck,
Biome and two cold/warm browser keyboard/focus/filter/restore journeys passed. Native full
G11 failed closed at calibration factor0.565 outside[0.75,1.75],21tests not run. Logs:
/tmp/taskdesk-palette-observer-{build,typecheck,browser,after,performance}.log; profiles
/tmp/taskdesk-palette-observer-{before,after}.json. Source/method review6318215302 and
security addendum6318258978. PR-template initially failed incorrect n/a security wording;
body corrected after explicit independent security review. Final import/docs review and
hosted checks remain required. Do not restart failed jobs blindly or claim a gate passed.
