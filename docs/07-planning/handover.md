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

Live accepted main: `2f366cd47a9124be2d995416d5eaf0878f5918b7` (#882).
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
| [#883 sidebar/project controls](https://github.com/ThomasHeinThura/ticketing/pull/883) | Candidate. Reviewed 0fc458a6 repairs displayed-project creation permissions after e1209855 passed G11/G8/PG but failed two browser controls. Native 28 tests and 20 browser journeys passed. Accepted main 2f366cd4 imported with byte-identical authored source diff. | Worktree ~/.codex/worktrees/taskdesk-sidebar-paint-scheduling, branch codex/sidebar-paint-scheduling. Import/docs delta review approved. Final head 2c4a1102 passed 17/18 checks; G11 palette click-to-paint failed (209.7 ms > 200 ms). Diagnose and repair before protected merge. |
| [#880 image build](https://github.com/ThomasHeinThura/ticketing/pull/880) | Candidate f7f140c7, source independently approved but prior G11 failed. Native shared-artifact compilation replaces the known 35-minute arm64 emulation path; actual multiarch release success is still unproven. | Worktree ~/.codex/worktrees/taskdesk-native-artifact-image-build, branch codex/native-artifact-image-build. Import accepted performance repair once merged, review delta, validate/merge, then verify actual release build, both architectures, scan and signing. |

## Immediate next work

1. Complete #883 on current main. Final-head workflows 39576068339 / 39576068126
   passed all required checks except G11. The 500-row render measured 487.0 ms (<500);
   palette readiness passed, but click-to-paint measured 209.7 ms (>200) after the
   existing retry. Log: /tmp/taskdesk-sidebar-2c4-g11.log; downloaded performance
   artifacts: /tmp/taskdesk-sidebar-2c4-perf. Profile the open interaction before patching;
   do not blindly rerun, relax budgets or treat 17/18 as merge clearance.
   Native integrated checks passed 48 unit tests and 23 browser journeys.
   The next repair removes duplicate toggle request/acknowledgement renders; two new
   cold/warm browser journeys passed search, focus containment, toggle/Escape and focus
   return. Source review is clean, but no hosted performance improvement is established.
   An independent palette diagnostic now retains its sanitized capture even if another
   diagnostic window fails. Native capture has valid canonical clock marks/timeline but
   rejects all CPU profiles: the first chunk contains signed negative time deltas, which
   the existing strict parser rejects. Do not label it complete CPU attribution or relax
   validation without tracing the actual V8 timestamp contract. Native logs:
   /tmp/taskdesk-palette-toggle-browser.log and /tmp/taskdesk-palette-native-diagnostic-4.log.

   Current implementation: It retains primary-content/paint/idle protection, prefetches
   project navigation alongside the sidebar, and scopes work/backlog create controls to
   the displayed project through the existing capability API. Tests withhold roster data
   and check project denial despite workspace permission. No budgets, assertion timeouts,
   calibration ranges, retries or fallbacks were relaxed. Prior G11 failures stay adverse
   evidence in #876/#711; a later green candidate does not erase them.
2. Complete #880 and verify its real multiarch release. Earlier release 39548649101's
   arm64 QEMU build hung after Vite transformed 7,397 modules and reached the 35-minute
   timeout. Do not increase the timeout or narrow supported architectures. CI amd64 image
   proof is not proof of a successful arm64 release.
3. Continue P1 requirements, then the approved P2–P4 sequence in the living plan. Hierarchy
   has parent/tree backend code, but the tree is capped at 500 nodes with a truncated flag;
   per-parent pagination (#434), canonical inline hierarchy UI and full lifecycle behavior
   need completion. Canonical work-item relations still need implementation; legacy task relations do not
   satisfy them.
   Audit before assuming existing code satisfies a rule. Do not replace missing functionality
   with a hidden feature or mark a whole feature/stage complete from a narrow test.

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
