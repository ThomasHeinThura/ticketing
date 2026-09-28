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
