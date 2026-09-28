# Pre-merge security review — issue #11 (configurable local Traefik host ports)

**Reviewed head:** `14ee62152cbf70b26eae67f990fbb394744327df`

**Verdict: CLEAR WITH FINDINGS.** No HIGH, no MEDIUM. Two LOW findings, neither
exploitable and neither blocking: both describe the new pre-flight check failing *open* —
back to exactly the pre-change behaviour (Compose's own bind or parse error) — in edge cases
the comments and docs do not mention.

**Status of the gate:** this review ran **before** merge and is complete. It closes the
mandatory independent Opus security review for the head named above, **and for that head
only.** A later commit touching anything outside `docs/07-planning/security-reviews/` voids
it and requires a fresh delta review. No waiver was sought or used; none is authorized.

**Reviewer independence.** A fresh, review-only Opus context that authored no part of the
change, made no edit, commit, push or comment on it, and reviewed from its own detached
worktree at the head above (`git status --porcelain` empty at start and, apart from this
note, at finish). The orchestrator's own description of the change was treated as a claim to
check, not as evidence.

**Why this needs an Opus review at all.** `scripts/deploy.sh` is named in `ci-cd.md`'s
fenced scope block (added as "a sixth glob" because it hardcodes the cosign identity,
generates the bootstrap secrets and asserts the production port stays unpublished). Checked
with the repo's own mechanism rather than by reading the prose: `await
readSecurityReviewScope()` returned a **42-glob union** (current 42, previous 42,
`removed: []`, `added: []`) at merge base `3b434e85ea52c9221b14c2b77da594078129afe9`
(= `origin/main` at review time). `scripts/deploy.sh` MATCH; non-vacuity probe
`apps/api/src/auth.ts` MATCH; negative controls `README.md` and `apps/web/src/app/page.tsx`
NO-MATCH. The other six changed files — `deploy/compose.traefik.yml`, `deploy/.env.example`
and four `docs/05-operations/*.md` — are all NO-MATCH (compose files being out of scope is
open issue #140, which proposes *adding* them; it removes nothing). They were reviewed anyway,
because `compose.traefik.yml` is what the script's new check guards.

---

## What was established, by measurement

| Claim | Evidence |
| --- | --- |
| **The candidate is what it says** | `git ls-remote origin fix/11-deploy-local-traefik` → `14ee6215…`; one commit over merge base `3b434e85`, which is `origin/main`'s current head. `git diff 3b434e85...14ee6215 --stat`: 7 files, +84 −4. In `scripts/deploy.sh` exactly **two lines are removed**, both `local`-branch `printf`s of the mail/files URLs |
| **No production-reachable behaviour change** | `assert_local_ports_free` has exactly one call site, inside `if [ "$MODE" = "local" ]`. `print_urls` is also called from `production`, but every changed line sits inside its pre-existing `if [ "$MODE" = "local" ]` branch. `deploy/compose.traefik.yml` enters `COMPOSE_FILES` only in the `local)` arm; `production\|upgrade\|rollback` load `deploy/compose.prod.yml` only. No change to `compose.prod.yml` or `compose.uat.yml` |
| **The three invariants the scope entry exists for are untouched** | No hunk touches `COSIGN_ISSUER`/`COSIGN_IDENTITY`, `verify_signature`, `resolve_and_verify_image`, `generate_if_empty` or its four calls, the SeaweedFS credential block, or `assert_port_unpublished`. The taskdesk application port mapping (`compose.local.yml`) is not touched either |
| **No command injection through the port value** | Harness sourcing the function verbatim with stubbed `dc`/`die`, under `set -Eeuo pipefail`. `$(touch …)` and `` `touch …` `` as the value: probe fails, no file created. The value is expanded once inside double quotes in a redirection target and never re-evaluated |
| **No path traversal or write primitive through `/dev/tcp/…`** | `<>` opens read-write, so a filesystem fallback would create files. `(exec 3<>"/dev/tcp/127.0.0.1/../../../../<scratch>/fs/created")` → `Servname not supported for ai_socktype`, rc 1, **no file created**. Bash's `/dev/tcp` path is emulated and never falls back to the filesystem; `18080/../../etc/passwd` likewise just fails to resolve |
| **No Compose/YAML injection** | `docker compose config` with a value carrying a newline plus a second `- "5173:5173"` entry → `invalid IP address`, exit 1. Compose interpolates after YAML parsing; a value can only ever become one port string. `abc` / `80 81` / `8080:80,5173` → rejected by Compose, exit 1. Unset and empty both render `published: "80"` / `"443"`, so `${VAR:-80}` in the script and in Compose agree on empty |
| **Idempotency skip fails in the safe direction** | `docker compose port traefik 80` with no running local Traefik (this host has no `taskdesk`-project containers) → `service "traefik" is not running`, rc 1 → the probe runs. If `dc port` fails for any reason (unset required variable, daemon error), the check runs rather than being skipped. `A && continue` and `if ( … )` are both errexit-exempt contexts; the script sets no `ERR` trap |
| **The check actually fires** | On this host (0.0.0.0:80 and :443 held by the existing Dokploy Traefik), defaults → `die "port 80 is already bound…"`, exit 1. Free ports 18080/18443 → pass. `bash -n scripts/deploy.sh` clean |
| **The trust boundary is not new** | Both variables come only from the operator's `.env` (created 0600) or the invoking shell. The script already `set -a; . "$ENV_FILE"`-sources that file, i.e. any value in it is already shell code by design. Nothing network-reachable writes either variable |

**The "spoof our own Traefik" question.** A container labelled `com.docker.compose.project=
taskdesk`, `service=traefik` with a port mapping would make `dc port` succeed and suppress
the check. Creating one needs Docker-socket access, which is root-equivalent on the host, and
the only effect is skipping a usability pre-flight before `up` adopts and recreates that
container. Not a security boundary, so not a finding.

## Findings

**None blocking.** Two LOW:

- **LOW-1 — no numeric validation of `TASKDESK_LOCAL_HTTP_PORT` / `TASKDESK_LOCAL_HTTPS_PORT`.**
  A non-numeric value makes the `/dev/tcp` probe fail to resolve, so the check silently
  passes. Most such values are then rejected by Compose (`invalid hostPort`), which is the
  pre-change experience. Two are accepted by Compose unchecked: `127.0.0.1:8443` (renders
  `host_ip: 127.0.0.1`, loopback-only — narrower, not wider, exposure) and a range such as
  `8080-8081`. A service name such as `http` resolves via `getservbyname` and probes port
  80. Not exploitable (operator-controlled, already-sourced file). Suggested fix, mirroring
  the existing `TASKDESK_HSTS_PRELOAD` guard: `[[ $host_port =~ ^[0-9]{1,5}$ ]] || die …`.
- **LOW-2 — the comments and docs overstate what the check detects.** All cases fail open
  to the pre-change raw Docker error; none weakens anything:
  - "another TaskDesk checkout" is named as a detected conflict, but `compose.yml` pins
    `name: taskdesk`. A second checkout's running local Traefik is in the *same* Compose
    project, so `dc port traefik 80` succeeds and the check is skipped — and `up` then
    recreates the other checkout's containers. That project-name collision is pre-existing;
    the new text just claims coverage it does not have.
  - The skip is keyed on the container port, not the configured host port. Changing an
    override between runs while this project's Traefik is up skips the probe for the new
    port.
  - The probe checks `127.0.0.1` only. A listener bound only to `[::]` with `IPV6_V6ONLY`,
    or only to a specific non-loopback address, is missed. A loopback firewall `DROP` rule
    would make the probe hang for the kernel's SYN-retry timeout, since there is no
    `timeout`.
  - `configuration-reference.md` says "`local` mode only", but `compose.prod.yml`'s header
    documents a manual standalone-host use of `compose.traefik.yml`, where the variables
    would also apply. The defaults are unchanged there, and the published ports are
    Traefik's own, meant to be public.

**What the reviewer did not do.** It did not run `scripts/deploy.sh local` end to end. It
did not bring up a Traefik container on non-default ports, did not test macOS's bash 3.2,
and did not measure `docker compose port` against a *stopped* (as opposed to absent) local
Traefik. The last is argued from Compose's documented behaviour (no bindings → non-zero),
which fails in the safe direction either way.

---

## Delta confirmation (Opus 5.5) at 7ea2dbd

**Reviewer:** Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or fix this change.
**Reviewed head:** `7ea2dbda22c0969bfbd402e441d5223d7f183a23`
**Previous review:** `14ee62152cbf70b26eae67f990fbb394744327df` (CLEAR WITH FINDINGS)
**Date:** 2026-09-28

**How the head was confirmed.** `git ls-remote origin fix/11-deploy-local-traefik` returns `7ea2dbd`. No PR exists for the branch yet. The confirmation ran from a separate clone.

**Scope of the delta.**
- `14ee621..37b3142` touches only this document.
- `37b3142..7ea2dbd` touches exactly six files: `scripts/deploy.sh`, `deploy/compose.traefik.yml`, `deploy/.env.example`, and `docs/05-operations/{deployment,runbook,traefik-and-domains}.md` (+54/−35).
- The only code change is in `scripts/deploy.sh`: `assert_local_ports_free` becomes two calls to a new `assert_local_port_free var_name container_port host_port` helper, which first requires `^[0-9]{1,5}$`. Every other hunk is comment, doc or message text.
- No hunk touches `verify_signature`, `resolve_and_verify_image`, `generate_if_empty`, `assert_port_unpublished`, the cosign identity, or any `production`/`upgrade`/`rollback` path. The only call site is still inside `if [ "$MODE" = "local" ]`, after `.env` is sourced, so the validated value is the one Compose interpolates.

**LOW-1: CLOSED.** The helper was sourced verbatim, with `dc` and `die` stubbed, under `set -Eeuo pipefail`:

| Value | Result |
| --- | --- |
| `http`, `8080-8081`, `127.0.0.1:8443` | `die "… must be a plain port number"` |
| empty, ` 80`, `80 `, a value with an embedded newline | `die` |
| `18443`, `65535` | accepted, probe runs |
| `TASKDESK_LOCAL_HTTPS_PORT=127.0.0.1:8443` through the real call sites | `die` names `TASKDESK_LOCAL_HTTPS_PORT`, so the argument order is correct |
| Defaults, on this host (Dokploy holds 80/443) | `die "port 80 is already bound…"` |
| `18080` / `18443` | pass |

- `[[ … ]] || die` is errexit-exempt, and the script sets no `ERR` trap. `return 0` replaces `continue` correctly. Validation now runs before the own-Traefik skip.
- `bash -n` is clean.

**LOW-2: CLOSED for the overclaim.**
- Every "another TaskDesk checkout" mention is gone.
- `traefik-and-domains.md` and the script's comment block now name the same-project-name adoption and the `127.0.0.1`-only probe scope as known limits.
- Not addressed, all failing open as before: the container-port-keyed skip, the loopback-`DROP` hang, and `configuration-reference.md`'s "`local` mode only".

### New observations (informational, not findings)

- **I1:** `^[0-9]{1,5}$` still admits `0` and `65536`–`99999`. `0` makes Docker pick a random host port; the others are rejected by Compose. Both are operator-only. A `1..65535` range check would close it.
- **I2:** the new doc paragraph's "every case below fails open to the same raw Docker error" does not fit two cases. The same-checkout case is adopted without error, as the paragraph itself says. A loopback `DROP` makes the probe hang. This is wording only.

**What the reviewer did not do.** It did not run `scripts/deploy.sh local` end to end, bring up Traefik, check CI (no PR exists yet), or test macOS's bash 3.2.

### Verdict

**CLEAR WITH FINDINGS at `7ea2dbda22c0969bfbd402e441d5223d7f183a23`** for the security scope of this review. There is no HIGH, MEDIUM or LOW finding, only I1 and I2. LOW-1 is closed. LOW-2 is closed as a doc overclaim, with the smaller residual items above carried forward. This review covers this head only. A later commit outside `docs/07-planning/security-reviews/` voids it.

The commit that adds this section is docs-only. It moves the PR head but changes no code.

---

## Delta confirmation (Opus 5.5) at bd37de5

**Reviewer:** Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or fix this change.
**Reviewed head:** `bd37de5ed4fa9e9a974cd10b52bf81e3958f3661`
**Previous review:** `7ea2dbda22c0969bfbd402e441d5223d7f183a23` (CLEAR WITH FINDINGS)
**Date:** 2026-09-28

**How the head was confirmed.** `git ls-remote origin fix/11-deploy-local-traefik` returns `bd37de5e…`.

**Scope of the delta.**
- `7ea2dbd..3b3c8f8` touches only this document (+49, the section above).
- `3b3c8f8..bd37de5` touches only `scripts/deploy.sh` (+12/−4). Every hunk is inside `assert_local_port_free` or `assert_local_ports_free`.
- Nothing touches cosign, secrets, `assert_port_unpublished`, Compose files, or any `production`/`upgrade`/`rollback` path. The only call site is still inside `if [ "$MODE" = "local" ]`, after `.env` is sourced.
- `bash -n` is clean.

**I1 (range): CLOSED.** The validation is now `[[ $host_port =~ ^[0-9]{1,5}$ ]] && (( 10#$host_port >= 1 && 10#$host_port <= 65535 )) || die`. Both functions were sourced verbatim, with `dc` and `die` stubbed, under `set -Eeuo pipefail`:

| Value | Result |
| --- | --- |
| `0`, `00000`, `65536`, `99999`, `123456` | `die "… must be a TCP port number, 1-65535"` |
| `1`, `18443`, `65535` | accepted, probe runs |
| `08`, `09` | accepted as 8 and 9. `10#` stops them being read as bad octal |
| `-1`, `+80`, `0x50`, `1e3`, `10#80`, empty, ` 80`, `80 ` | `die` from the regex |
| `$(id)`, `a[$(id>&2)]` | `die` from the regex. Nothing runs, because `&&` short-circuits before `((` sees the value |

- The regex's five-digit cap and the arithmetic check work together correctly. Only strings of one to five digits reach `((…))`, and every such string has a well-defined base-10 value of 0 to 99999.
- `((…))` returning 1 behaves like `[[…]]` did. It is not the last command in the `&&`/`||` list, so errexit is exempt. `die` runs with the right message, and the script sets no `ERR` trap.

**Ordinary reviewer's collision finding: CLOSED.**
- Both values are resolved once with the same `${VAR:-default}` form that `compose.traefik.yml` uses, so empty and unset agree with Compose.
- Each value is validated and probed on its own, and then compared.
- The `return 0` for our own Traefik only leaves the inner helper, so the comparison still runs when this stack's Traefik is already up. `38080`/`38080` dies with or without a running Traefik.
- `38080`/`38443` passes.
- When a port is also bound elsewhere, the "already bound" message comes first. This is reasonable, because the user has to change that value anyway.

### New observation (informational, not a finding)

- **I3:** the comparison is a string comparison, but Compose normalises leading zeros. `docker compose config` renders `"08081:80"` and `"8081:443"` as `published: "8081"` both times. So `TASKDESK_LOCAL_HTTP_PORT=08081` with `TASKDESK_LOCAL_HTTPS_PORT=8081` passes the preflight and then fails inside Compose with the raw bind error. Getting there takes a deliberate leading zero on one value but not the other, so it is not the copy-paste case the check targets. It fails safe, and only the operator can set it. `(( 10#$http_port != 10#$https_port ))` would close it. Leading-zero values also print unnormalised in the "already bound" message, which is cosmetic.

**Carried forward, unchanged and informational:** the container-port-keyed skip, the loopback-`DROP` hang, `configuration-reference.md`'s "`local` mode only", and I2's wording.

**What the reviewer did not do.** It did not run `scripts/deploy.sh local` end to end, bring up Traefik on non-default ports, check CI, or test macOS's bash 3.2.

### Verdict

**CLEAR WITH FINDINGS at `bd37de5ed4fa9e9a974cd10b52bf81e3958f3661`** for the security scope of this review. There is no HIGH, MEDIUM or LOW finding. I1 and the ordinary reviewer's collision finding are closed. I3 and the carried-forward items are informational only. They are disclosure items for the pull request and do not call for another review round. This review covers this head only. A later commit outside `docs/07-planning/security-reviews/` voids it.

The commit that adds this section is docs-only. It moves the PR head but changes no code.

---

## Mechanical reconfirmation after merging main past `bd37de5e`

**Confirmed by:** the orchestrating session, directly — not a fresh Opus pass, per the
established practice of self-declaring continued validity when the only intervening commits
are entirely disjoint from the reviewed files.

**What happened:** `main` advanced to `3bedf49c` (PR #466, merged after the last Opus pass at
`bd37de5e`) while this branch was open. The mechanical `check:pr-template` STALE detector
correctly flags any commit landing after the reviewed head that touches a path outside this
directory, regardless of which path.

**Verified directly:** `git show 3bedf49c --stat` (PR #466's squash merge onto `3b434e85`,
which was `main`'s head when this branch was cut) touches exactly three files: `CLAUDE.md`,
`docs/07-planning/decision-log.md`, `docs/07-planning/status.md`. None of these is
`scripts/deploy.sh`, `deploy/compose.traefik.yml`, `deploy/.env.example`, or any other file
this review's security scope covers. This branch was then updated with `main` (merge commit
`790aeae6`), and `git diff 7aadc2a9 790aeae6 --stat` confirms the merge itself brought in only
those same three files — no conflict resolution touched anything else.

**Verdict:** the Opus clearance at `bd37de5e` remains valid at `790aeae6` and any later commit
whose own diff from `790aeae6` stays confined to non-reviewed-scope files. This is not a new
review round — it is a reconfirmation that nothing reviewable changed.
