# Full audit and fix plan — 8 Nov 2026 (Claude)

**Scope:** `main` 893b6f9 plus the 8 Nov Codex and Gemini reports. Eight read-only lenses (roadmap, service-desk features, core-work features, API code, web code, security, tests and architecture, docs and decisions); an independent agent tried to refute each high and medium finding. Findings below are new; D1–D18 and G1–G9 are in [verification and plan](verification-and-plan-2026-11-08.md) and roadmap rows A8-1…A8-12.

**Not done:** no browser or user-journey testing, because Docker Desktop (local SIT) is down. Low findings were not independently re-checked. Nothing here was run against UAT.

## 1. Roadmap and docs

| ID | Finding | Verdict | Fix |
| --- | --- | --- | --- |
| R-01/02 | Roadmap says 86 open issues; GitHub has 118. None of A8-1…A8-12 has an issue. | Counted by agent; skeptic could not re-run `gh` | Re-run the ledger; one issue per A8 row; put each open issue in one row or close it |
| R-03/04, DOC-5 | Handover (titled 4 Nov) still treats UAT as a future 6 Nov launch; says U-1…U-15 done while U-10 (Thomas sign-off) is open | Confirmed | Rewrite handover as of 8 Nov; add a state column to U rows |
| R-05 | AGENTS.md calls G11 a gate; testing.md and roadmap say report-only | Confirmed | State the rule once |
| R-06 | #560 (WebSocket origin and portal check), #231/#232 (bootstrap races) and #229/#230 sit low in L-09/L-07 while UAT has open self-registration | Ordering confirmed | New row ahead of L-01 |
| R-09 | Index has 668 of 673 rows "unverified"; "accepted P0–P6" has no per-ID evidence | Confirmed | L-01 stays the first audit row |
| R-11 | **A8-2 premise is wrong.** `feature-contracts-p1.md` already requires `project:archive`; `permissions.md:26` aliases it to `project:update`. The alias is the defect, not the contract | Skeptic refuted my first wording | Thomas confirms removing the alias |
| DOC-1 | `docs/report/` is 141 MB, 2,277 tracked files | Confirmed | Thomas decides what to archive |
| DOC-2, S-10 | UAT host names in `docs/uat-role-checklist.md` and tracked deploy files | Confirmed | Replace with placeholders (A8-10) |
| TA-5 | CI docs cite `docs/04-engineering/ci-cd.md`, which exists only in `archive/` | Confirmed | Point to `ci-gates.md` |
| DOC-9 | Uncommitted AGENTS.md block has typos and a duplicate rule | Confirmed | Rewritten in this change |

## 2. Features that are incomplete

| ID | Finding | Severity |
| --- | --- | --- |
| F5/F-FEAT-2 | Workspace invite always sends `role: "member"` (`// TODO` in `invite-team-member-modal.tsx`) | Medium |
| F2 | Portal "add participant" endpoint is in the contract, absent in code | Medium |
| F3 | OIDC group-mapping API has no God Mode UI | Medium |
| F-FEAT-1 | Work-item filter has no label field | Medium |
| F1/F-FEAT-4 | Data protection (person export, anonymise, place/lift legal hold, subprocessors) specified, not built | Medium: build or descope |
| W1 | God Mode Observability: hard-coded English, no admin gate, hangs on "Loading" after an error | Medium |
| F4, F6 | Non-compliant-items report and pending-action deny have no UI | Low |

## 3. Code, security, tests

| ID | Finding | Severity |
| --- | --- | --- |
| S-1 | No per-account sign-in lockout; only a per-IP in-memory limiter | Medium |
| S-4 | Backups are plaintext with checksums beside the data | Medium |
| API-1 | Failed job handlers are recorded with no logged cause | Medium |
| API-3, API-2 | Concurrent workflow-version create can 500; vacated upload key failure swallowed | Low |
| S-2, S-3, S-5…S-13 | CSP-report limiter on raw IPv6; webhook timestamp unsigned; unpinned image digests; Valkey open inside the network; MCP over HTTP; public OpenAPI; dead `/auth/device`; Docker socket; `--no-verify` flag | Low |
| TA-1 | SIT regression suite covers 4 specs of the Level 2 table (L-03a) | Medium |
| TA-6 | No scheduled workflow for the weekly load, restore, upgrade, a11y and Trivy runs | Medium (needs Thomas: workflow edit) |
| TA-2…4, 7, 8 | Boundary doc names missing packages; libs↔api type cycle; stale "not built" notes; oversized modules; coverage gate only for `domain` | Low |

## 4. Useless or dead UI

| ID | Finding |
| --- | --- |
| W2 | `/test-error` Kaneo route ships in the agent app |
| W3 | Dead Kaneo checkout-intent code runs at every boot |
| W4 | Four unreferenced components (`tasks-import-export`, `delete-team-member-modal`, …) |
| W5 | Portal notification bell: two-line menu that repeats its own badge, no error state |
| W6–W8 | English toast and tooltip strings; dates ignore app language; filter buttons remove their focus ring (check against the focus gate) |
| W10 | `comment-editor.tsx` 2,607 lines and nine more over 1,000: split when touched, not as a project |

## 5. Plan

One PR per row, tests first, in this order. Each goes through the AGENTS.md test order. Security rows get an independent high-effort review.

| Order | Row | Content |
| --- | --- | --- |
| 1 | A8-1 | IPv6 guard (D1) |
| 2 | A8-2 | Archive/columns/rules permissions (D2, R-11); **Thomas confirms** |
| 3 | SEC-1 | Per-account lockout (S-1), plus check #560, #231/#232 |
| 4 | A8-4 | Request forms (D4, D5, D9, D10) |
| 5 | A8-3 | Request Types and Terminology gates |
| 6 | FIX-1 | Invite role (F5), Observability i18n/gate (W1), job error log (API-1), dead UI (W2–W5) |
| 7 | A8-6, A8-5, A8-7 | Portal fixes, phone layout and a11y, Triage boundary (needs local SIT) |
| 8 | C8-6 | **G11 passes** (Thomas, 8 Nov): fix the four misses by making the app faster, test first, no threshold, calibration or harness change. Diagnosis runs now (LCP, list → detail, board drag, assignment click, server side) |
| 9 | FEAT-1 | Label filter (F-FEAT-1), portal participants (F2), OIDC mapping UI (F3) |
| 10 | DOCS-1 | Handover, roadmap ledger, A8 issues, host names, AGENTS.md |
| later | A8-8…A8-12, TA-6, F1 | Wait for Thomas |

## 6. Decisions needed from Thomas

1. Remove the `project:archive` → `project:update` alias (A8-2): leads lose archive and column/rule edits.
2. Data protection (F1): build before customers, or descope from `features.md`.
3. Scheduled CI workflows (TA-6), CSP enforcement (A8-9), UAT seed data (A8-8), dependencies (A8-11), customer password recovery (A8-12).
4. What to do with the 141 MB `docs/report/` tree.
5. Whether to open the A8 GitHub issues (outward-facing).
