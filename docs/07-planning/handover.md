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

Live GitHub main inspected for this update: `a13edc671f5644dddd629b44134131455932eec9`.
The primary checkout is clean at that revision; these documentation edits are on #882.
Do not discard other worktrees or have two sessions edit the same file.

| Change | Evidence/state at this snapshot | Continue here |
| --- | --- | --- |
| #875 integration sharding | Merged, 18 required checks passed; slowest measured partition 8m43s versus former 31m22s serial step. This is not total pipeline duration. | Preserve all gates. |
| #877 container seeding; #878 isolated recovery | Merged with 18 required checks each. Restricted credential/idempotent submissions and isolated row/nonempty-file restore evidence exist. Full operational acceptance remains. | Finish P0 backup/runtime/recovery obligations. |
| #870 approval decisions | Merged after required checks/review; approval request/candidates still missing. | Continue P2 prerequisites and request flow. |
| #871 Kaneo work-item full page/side pane | Merged on reviewed `bf3c6b95`, all 18 required checks green. | Hierarchy/relations and remaining P1 acceptance still outstanding. |
| #881 canonical labels | Merged on reviewed `a871a853`, all 18 required checks green. | Project-scoped label catalogues remain unfinished. |
| [#880](https://github.com/ThomasHeinThura/ticketing/pull/880) native artifact image build | Head `f7f140c7`; G11 failed. Separate build fix independently reviewed; candidate amd64 boot passed. Multiarch release fix is not proven. | Worktree `~/.codex/worktrees/taskdesk-native-artifact-image-build`, branch `codex/native-artifact-image-build`. Import accepted performance repair later, review delta, require exact-head checks, then verify actual multiarch release/scan/sign. |
| [#883](https://github.com/ThomasHeinThura/ticketing/pull/883) sidebar idle scheduling | Reviewed candidate `e1209855` now overlaps project-navigation downloads with the sidebar after primary content; 25 native tests and 11 browser journeys passed. Hosted runs `39569215028`/`39569479207` are pending verification. Prior `5c0e5410` run `39559280947` failed G11; preserve that evidence. Do not merge or blindly rerun. | Worktree `~/.codex/worktrees/taskdesk-sidebar-paint-scheduling`, branch `codex/sidebar-paint-scheduling`. Diagnose `/tmp/taskdesk-883-5c-g11.log`, job `119086380484`: 21/22 tests passed, but G13 setup could not find the palette popup within 5 seconds. Preserve budgets/calibration/assertions. |
| [#882](https://github.com/ThomasHeinThura/ticketing/pull/882) canned-response management | Management and placeholder implementation are on this branch. Prior `06f0332b` full run `39559618827` failed G8 on the obsolete General Settings baseline; independently reviewed image update is `80c87ad0`. Source/retry repair `ce238f4e` was independently approved. Its hosted run `39563587447` passed G8 but failed integration shard 1, real API browser and G11; tests are being repaired without changing product policy or budgets. The manager fixture lacked its genuine system role row; browser POST body was read after reload discarded it. CA-19a interpolation integration itself passed. G11 list render was 506.3ms against <500ms. Refresh the current head before using CI evidence. | Worktree `~/.codex/worktrees/taskdesk-canned-response-management`, branch `codex/canned-response-management`. Prior job `119087861180` passed scope validation, then the obsolete screenshot differed by 248,094 pixels (27%). Actual Linux artifact was inspected and baseline updated without tolerance changes; log `/tmp/taskdesk-canned-06f-g8.log`. Require final-head G8. |

## Immediate implementation continuation

1. #882 CA19 placeholder interpolation is authored after `80c87ad0`, pending
   hosted repair verification. Independent source/security and retry reviews passed through
   `ce238f4e`; integration/browser test repairs after its hosted failures need delta review.
   The retry unit regression also now
   waits for hydrated/persisted draft state and an enabled selector before retry, retaining
   its successful-insertion assertion; both isolated and combined verification are required. The initial review found stale cached
   due-date expansion on an open item; insertion now fetches fresh authorized context, locks
   editing/sending while pending and preserves drafts on failure/removal. Settings persists reusable rich-text
   templates; item composer listing expands only authorized live-item context. Native checks
   passed: domain 676 tests (eight new resolver cases), API unit 884, permissions 107,
   API/web typechecks, three mock browser journeys, 16 activity editor tests and 418 contrast pairs.
   Final-head PostgreSQL, real API browser, G8 and required CI remain required; earlier-head
   partial passes do not establish full acceptance.
2. The CA-19a contract now specifies `{{requester.name}}`, `{{work_item.key}}` and
   `{{work_item.due_date}}`; UTC calendar date, empty missing values, unknown tokens
   retained and no expression execution. Adjacent formatted text nodes are supported;
   attributes/URLs and stored templates remain unchanged. Integration tests cover an
   external contact without workspace membership, linked-user name fallback, missing
   values and template immutability. The real API browser journey now authors a key token
   through settings and expects a resolved editable draft; this new path is not yet
   runtime-verified. No full CA19/P2 completion claim until that evidence passes.
3. Existing relevant paths: `apps/api/src/canned-response/repository.ts`,
   `apps/api/src/canned-response/controllers/list-canned-responses.ts`,
   `packages/domain/src/`, feature spec CA19, and
   `apps/web/e2e/work-item-comments-journey.spec.ts`. `person.displayName` exists; requester
   contacts legitimately need not be workspace users. Keep query ownership in repositories
   and get independent security review for requester context and isolation.
4. Diagnose #883 G11 from the actual failure before another scheduling change. Earlier #880
   failure was palette readiness near the 5-second setup limit even though numeric budgets
   passed. Do not assume #883 failed for the same reason. Track adverse evidence in #876/#711.
5. For #882 G8, the actual hosted diff was inspected: expected was the superseded General
   Settings redirect; actual is the correct library in Kaneo settings. The one Linux image
   was updated at `80c87ad0` with independent image-only approval. No tolerances changed;
   final-head G8 must still pass. Artifacts: `/tmp/taskdesk-canned-06f-visual/`.
6. For every changed head: affected native checks, hosted required checks, independent
   review and protected merge. No timeout/budget relaxation, skipped tests or manual statuses.

## Hosted integration and remaining scope

The read-only VM assessment found 2 vCPUs, 7.7 GiB RAM and 166 GiB free: suitable for light
functional SIT, not reference performance acceptance. Existing Traefik uses Docker network
`web` and ACME resolver `le`, while the stock overlay assumes `proxy`/`letsencrypt` and an
absent file-provider middleware. Prepare/review a compatible isolated Compose overlay.
Validate Cloudflare/origin TLS and trusted forwarded-client-IP handling; do not guess a
proxy hop count. Keep database/cache/application ports unpublished. Do not opt into the
existing Watchtower's unattended replacement. No remote application changes have been made.

P0 backup encryption/offsite/retention/runtime records and full restore walkthrough remain.
P1 needs complete hierarchy/relations, project labels and remaining work/view acceptance.
P2 needs teams/CAB/custom fields, approval requests, configuration/editor journeys,
SLA/workflow completeness, canned runtime verification, audit and delivery planning.
P3 needs the full host-root portal, admission contracts and implementation, identity admin,
and all 25 real-Entra acceptance tests; credentials are an external verification dependency.
P4 needs governance APIs/UI, full notification runtime, automations, God Mode, MCP/API-key
completion and #580 repository query ownership with a genuine structural gate.
The approved evaluator failure policy is 24 hours, then stop automatic evaluation, expose
failure administratively and permit explicit retry. #626 manual obligations remain visible.
The full numbered-requirement map is still incomplete; do not invent completion percentages.

After features: comprehensive integrated/security/Kaneo review, real agent/portal journeys,
installation/upgrade/image health, isolated backup/restore, exact SHA/digest deployment,
developer walkthrough and private test accounts. Report implemented/verified/blocked/awaiting
Thomas's sign-off separately. Missing external evidence never manufactures completion.
