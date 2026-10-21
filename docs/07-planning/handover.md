# Active handover — 22 October 2026 integration repair

Read [status.md](status.md) first. No P0–P4 stage is complete or awaiting only human review.
The full goal and Thomas's no-AIDLC, Kaneo-preservation directive remain in force.

- Repair worktree: `/Users/heinthura/.codex/worktrees/taskdesk-sit-alignment`,
  branch `fix/sit-kaneo-integration`, based on Antigravity `90973b7e`. Preserve unrelated
  dirty files in the primary checkout; do not merge duplicate hierarchy branches blindly.
- VM runtime directory: `/home/bimdevops/taskdesk-sit`, Compose project `taskdesk`.
  Old VM source checkout was privately archived, checksum verified, then removed. Named
  volumes remain intact. OrbStack stays stopped; Cloudflare stays enabled. No VM builds.
- Current image digest: `sha256:8ba4fdc714c7161e0e70c3732e0ab316f7e978a2514712a13ec3ed8911acaf1f`.
  Its source revision remains unknown. UI repair is not deployed; do not rerun old seeds
  or publish the rotated credentials. Private account/recovery files are outside Git.
- Source repairs restore the project header/calendar/timeline on canonical work data,
  missing Tailwind application utilities, portal shell/home/approvals/paging/draft and
  cache isolation, audit URL/filter state, private seeds and SIT image verification.
- Web 1,486/API 902 unit tests pass; independent standard/security source review approves
  after actual findings were fixed. Browser/visual/performance/exact-image acceptance open.
  G8 must stay failed until pinned Linux candidates are reviewed and committed. CI captures
  candidates only after failure and preserves original evidence separately.
- Isolated PostgreSQL: 87/89 broad tests passed, two WAN timeouts remain unpassed; three
  focused seed/label checks passed. Keep these adverse results visible; hosted co-located
  PostgreSQL checks must resolve them. Never run database resets against live SIT.
- Draft PR #889 latest pushed head `3a863039` contains the source/evidence batch. Hosted results
  and local fixes are recorded in status.md; do not blindly rerun old failing jobs. All four
  PostgreSQL shards pass in the second run; approved Linux captures and the calendar
  ScrollArea/keyboard fix are the next batch. G11 failed calibration before measurements. Browser158passed/1calendar accessibility
  failure is repaired locally and reviewed; shipping-image build was skipped, not passed.
- Next: finish source/baseline fixes and hosted G11 measurement, bind delta review, then
  verified-image deployment and developer walkthrough. Repair the separate proxy-IP defect
  before claiming login rate-limit or API-key IP acceptance. The candidate normalizer
  passed nginx syntax/readiness and trusted IPv4/IPv6 versus invalid/untrusted header
  tests; it was removed after testing and live routing is unchanged. App-IP-change,
  live attribution/forgery, upload and WebSocket checks remain. See the hosted SIT
  section in [traefik-and-domains.md](../05-operations/traefik-and-domains.md).
  Continue the remaining requirement-level P0–P4 work; do not hand unfinished stages to Thomas.

---

## Historical snapshot — 21 October 2026

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
- **TaskDesk is deployed and operational on the proxy VM.** Both HTTPS origins (`https://tickting.technexus.info` and `https://portal.technexus.info`) are responding healthy with Cloudflare proxy and Traefik Let's Encrypt TLS.
- Historical account passwords were exposed and rotated on 22 October. Use the private
  credentials file outside Git; these old walkthrough claims are superseded by the active
  audit above.
- OrbStack remains stopped locally as required. All remote containers run non-root (UID 10001) with unpublished application port 5173.
- No stage is complete or signed off. Only Thomas's actual SIT walkthrough closes stages.

## Accepted code and current branches

Live accepted main: `a99483a7befd97d91dce5853b428dc6994d74aca` (#887).
Primary checkout is clean at that source. Refresh live GitHub before acting.

| Change | Verified state | Continuation |
| --- | --- | --- |
| #875 integration shards | Merged; all18 checks. Slowest measured partition8m43s versus former serial step31m22s. | Preserve fail-closed collector; this is not total pipeline time. |
| #877 seed; #878 recovery | Merged; repeated restricted-credential submissions, isolated actual DB-row/nonempty-file restore, denied egress and health passed. | Remaining P0 backup/runtime/recovery acceptance. |
| #870, #871, #881, #882, #883 | Merged with all required checks and independent reviews: approval decisions, canonical Kaneo page/pane, workspace labels, canned responses, project controls/sidebar. | Full P1/P2 integrated acceptance remains. |
| #884 project catalogues | Merged on reviewed94eb6795 to f7a24732; all18 checks,152 browser tests,G8,G11(22/22),PG,image boot passed. | Do not reimplement. Complete hierarchy and remaining P1. |
| #885 CPU samples | Merged after all18 checks; both hosted CPU diagnostics passed. | Signed V8 deltas are valid timestamp differences. Do not carry old parser defect forward. |
| #880 image build | Open046e4964;17/18 checks, palette243.2ms>200. | Worktree taskdesk-native-artifact-image-build; import accepted fixes only, review, allchecks then actual multiarch release. |
| #886 observer correction | Open2adfb88c;17/18 checks; palette195.1ms passes, list528.7ms>500 fails. | Worktree taskdesk-palette-measurement; diagnose actual list boundary, no blind rerun/merge. |
| #887 hierarchy API | Merged to a99483a7 on reviewed2007b480; all18 checks,152 browser tests,image smoke passed. | Complete inline UI and remaining hierarchy lifecycle; not #434/P1 acceptance. |
| #888 hierarchy inline UI | Candidate codex/hierarchy-ui in ~/.codex/worktrees/taskdesk-hierarchy-ui, imports accepted main a99483a7. | Confirm main target after import. Five fixture browser journeys,1446 web unit,lint/typecheck,428 contrast pass. Source/security approval a9db0121; import/doc delta review and hosted actual API evidence pending. |

## Immediate next work

1. Finish hierarchy UI: actual persisted51-child pagination/reload/ancestor-navigation browser
   journey is authored in work-item-comments-journey.spec.ts but not yet run (hosted only).
   URL restoration caps8192 bytes/32 entries/3 automatic pages per disclosed node; manual
   load-more remains unrestricted. Independent review approved repaired bounds/security and
   source-bound contrast manifest. All418 original pair semantics unchanged;10 new pairs.
   Final exact-head review and required CI/image checks remain. Native full-unit attempt hit
   two unchanged process-lock fixture timeouts; isolated11 tests and complete sequential
   recheck (12 tasks) passed. Adverse initial run remains in the logs.
2. Complete #880 and verify the actual amd64/arm64 release, scanning and signing.
   Release39548649101 timed out at35 minutes during QEMU arm64 Vite7397 modules.
   Candidate builds CPU-independent artifacts on BUILDPLATFORM, with target production
   dependencies/runtime. Do not raise timeout, drop arm64 or infer success from amd64.
3. Continue full P1 then P2–P4 sequence in plan.md. Hierarchy read API/UI is only a part:
   parent editing/atomic child creation, lifecycle/move/orphan/close behavior, relations and
   other full-spec obligations remain. Legacy task relations are not canonical completion.

Evidence paths are session-local /tmp logs; authoritative hosted runs and review comments
remain on their PRs. #887 final fast39620825657/full39620825499. #884 final
fast39613713781/full39613713595; review6318052802/completion6318362126. #886 failure
/tmp/taskdesk-palette-2ad-g11.log; #880 /tmp/taskdesk-image-046-g11.log. UI current
/tmp/taskdesk-hierarchy-ui-{tokens-final,all-web-tests-final,lint-final,typecheck-all-final}.log.

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
