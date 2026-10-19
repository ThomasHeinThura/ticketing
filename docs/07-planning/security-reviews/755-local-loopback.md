# PR #755 security review record: local stack listens on loopback only (#752)

PR #755 closes #752 under Thomas's 2026-10-15 decision to restrict the laptop SIT to loopback. The local Traefik publishes HTTP and HTTPS on `127.0.0.1` and `[::1]` only. The application port `5173` is no longer host-published; Traefik reaches it over the container network, and `scripts/deploy.sh` probes it inside the container. Docs that said the local overlay publishes `5173` are corrected, and `scripts/ci/local-overlay-loopback.test.mjs` guards the overlay files. `scripts/ci/**` is security-scope.

The conductor (Claude Opus 5.5) implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `6cc3eebe`, then APPROVE on the deltas at `f17561fd` and `049aa62f`.
- Ordinary review B by Claude Sonnet 5.5: REQUEST CHANGES at `6cc3eebe` (stale "publishes 5173" text), fixed at `f17561fd`; APPROVE at `f17561fd` and `049aa62f`.
- Security review by Claude Opus 5.5: CLEAR at `e8739ff8` (head moved from `f17561fd` by formatting only). Non-blocking notes: the test reads only the two named overlays; the Postgres docs wording and the production-message hedge were corrected in `049aa62f`; the SIT reachability record was corrected for LAN 80/443 (accepted, then closed, with no response).
- Security rebind by Claude Opus 5.5: CLEAR at `049aa62f`; the delta is docs and message text only.
- Mechanical security rebind by Claude Opus 5.5: CLEAR at `144b01bb`, a clean merge of `main` `8ed5fef2` (#756, docs only); merge-tree equality checked, and the loopback test passes 6/6.

**Reviewed head:** `e8739ff8cff052050e3b81ed083df53eb46cb9ac`
**Reviewed head:** `049aa62fc1d83f928e83c53c62e7dbf285bb5468`
**Reviewed head:** `144b01bb8bf9afaec82907181bdccc1b46f1477e`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `755-ordinary-a-sonnet.md` | Ordinary review A (main..049aa62f) | Claude Sonnet 5.5 | `049aa62f` | APPROVE | `eaf8d3815ea6a5a97da5557ff4190d5e1dbabf3e1efe4dd9c1f4807d02aad323` |
| 2 | `755-ordinary-b-sonnet.md` | Ordinary review B (main..049aa62f) | Claude Sonnet 5.5 | `049aa62f` | APPROVE | `afc7f874be0c48dd039c4daa4727046517ce7be8bd846455ab42ff101a996948` |
| 3 | `755-security-opus.md` | Security review and rebind (main..049aa62f) | Claude Opus 5.5 | `049aa62f` | CLEAR | `659c76adc8cdbd897b94b0171314a600294dcab27428d810a675b023ab8e46af` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/755-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 eaf8d3815ea6a5a97da5557ff4190d5e1dbabf3e1efe4dd9c1f4807d02aad323) -->
# PR #755 ordinary review A (local overlays loopback-only, #752)

**Reviewed head:** 6cc3eebeae3a9f01bf58484abfd49023de75e30b
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Base compared: merge-base with origin/main d159704b. Head confirmed with `gh pr view 755` before review (unchanged). Scratch detached worktree, removed afterwards.

## Scope
Four files: deploy/compose.local.yml (drops the taskdesk `5173` publication), deploy/compose.traefik.yml (Traefik 80/443 bound to `127.0.0.1` and `[::1]`), docs/05-operations/traefik-and-domains.md (new "Loopback only" paragraph), scripts/ci/local-overlay-loopback.test.mjs (new).

## Checks and results
- Compose semantics: `docker compose -f compose.yml -f deploy/compose.local.yml -f deploy/compose.traefik.yml config` (dummy env, config only, nothing started). Resolved ports: traefik 80 and 443 each published on host_ip `127.0.0.1` and `::1`; postgres `127.0.0.1:5432`; taskdesk and mailpit publish nothing. With `TASKDESK_LOCAL_HTTP_PORT=8080` (json output) the variable substitutes correctly inside the `[::1]:${VAR:-80}:80` form (published 8080 on both families). The bracketed IPv6 form is valid short syntax and does not collide with the IPv4 entry.
- Reliance on host 5173: grepped the whole tree excluding node_modules. `scripts/deploy.sh` probes with `dc exec -T taskdesk wget http://127.0.0.1:${port}/...` (inside the container), the Dockerfile HEALTHCHECK is in-container, Traefik labels use the service port over the `taskdesk` network. `install.sh`/ci tests mentioning 5173 concern the production "port must be free" check and fake docker inspect output, unaffected. Test fixtures that mention `localhost:5173` are host-header values, not network binds. No e2e or CI script connects to host 5173. `container_binds_host_port` iterates all HostPort values, so two bindings per container port (IPv4+IPv6) still match. `assert_local_port_free` probes only 127.0.0.1; unchanged and still adequate for the IPv4 entry (documented as best-effort).
- Test: `node --test scripts/ci/local-overlay-loopback.test.mjs scripts/ci/install.test.mjs` -> tests 54, pass 54, fail 0, exit 0. The new file is covered by `pnpm test:ci-scripts` glob (`scripts/ci/**/*.test.mjs`), which CI runs.
- Non-vacuity: with main's two overlay files copied in, the test fails 4 of 6 (local loopback, local no-app-port, traefik loopback, both-families). Mutation A (delete the `[::1]` 443 entry) fails the both-families test. Mutation B (`127.0.0.1:5432:5432` -> `5432:5432`) fails the local loopback test. All reverted; worktree clean. The parser self-test confirms it detects wildcard binds and a published taskdesk port, and it rejects unquoted/long-form entries instead of passing silently.
- Docs: new paragraph is accurate against the resolved config (Traefik 80/443, Postgres 5432, 5173 unpublished, `ports: !override` for a user's own overlay).

## Findings
Blocking: none.

Non-blocking (stale statements left behind by the change, all in comments/docs, no behaviour effect):
1. compose.yml header lines 8-10 still say "Publishing 5173 is the job of deploy/compose.local.yml".
2. docs/05-operations/deployment.md:123 table row says compose.local.yml "publishes 5173".
3. docs/05-operations/traefik-and-domains.md:88 ("publishing 5173 is the job of deploy/compose.local.yml") and :99 ("Locally, 5173 being bound is the expected state") now contradict the new paragraph a few lines below in the same file.
4. docs/05-operations/proxy-topology-evidence.md:172 "only deploy/compose.local.yml publishes 5173".
These should be corrected in this PR or a tracked follow-up; the new loopback paragraph is correct, the older sentences are not.

## Residual risk
- Hosts with IPv6 disabled at the kernel level may fail to bind `[::1]` and fail `up`; not exercised here (no `up`). The preflight does not check `::1` availability.
- Local stack is no longer reachable from a LAN peer by default (intended); the docs describe the opt-in overlay.
- Did not run an actual `up` (instructed config-only).

**Verdict:** APPROVE

---
# Delta review (6cc3eebe -> f17561fd)

**Reviewed head:** f17561fd8b2e52bfb7932f2a964d1ed197b783ce
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Live head confirmed. New commit only edits comments/docs/one error message: compose.yml header, scripts/deploy.sh (section comment and the `assert_port_unpublished` failure text), deployment.md (table row and the local `up` command, now with compose.traefik.yml, matching scripts/deploy.sh local), traefik-and-domains.md (lines 88 and 99), proxy-topology-evidence.md. All four stale statements from my earlier non-blocking list are corrected and accurate against the resolved config; grep for "publishes 5173/publishing 5173/5173 being bound" outside planning docs now returns nothing. The changed deploy.sh message is not asserted by any test or doc (grep). The production assertion logic is untouched.
- `bash -n scripts/deploy.sh`: exit 0.
- `node --test scripts/ci/local-overlay-loopback.test.mjs scripts/ci/install.test.mjs`: tests 54, pass 54, fail 0.
Findings: none new. Minor: a few long lines in deployment.md/traefik-and-domains.md; cosmetic.

**Verdict:** APPROVE

---
# Delta review 2 (f17561fd -> 049aa62f)

**Reviewed head:** 049aa62fc1d83f928e83c53c62e7dbf285bb5468
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Live head confirmed. `git diff f17561fd 049aa62f`: (1) biome reformatting of the test file only (line wrapping, no logic change); (2) traefik-and-domains.md now says Traefik ports on `127.0.0.1` and `[::1]`, Postgres on `127.0.0.1:5432` (accurate against the resolved config); (3) deploy.sh production-assertion message hedged ("usually", also host networking), text only.
- `bash -n scripts/deploy.sh`: exit 0.
- `node --test scripts/ci/local-overlay-loopback.test.mjs scripts/ci/install.test.mjs`: tests 54, pass 54, fail 0.
- `npx biome ci --diagnostic-level=error .` after `pnpm install --frozen-lockfile`: checked 2346 files, exit 0.
Findings: none.

**Verdict:** APPROVE
<!-- END REPORT (sha256 eaf8d3815ea6a5a97da5557ff4190d5e1dbabf3e1efe4dd9c1f4807d02aad323) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/755-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 afc7f874be0c48dd039c4daa4727046517ce7be8bd846455ab42ff101a996948) -->
# Ordinary review B, PR #755 (architecture, contracts, whole-system consistency)

**Reviewed head:** 6cc3eebeae3a9f01bf58484abfd49023de75e30b
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** origin/main d159704be626136e728df7ddef0381dc37cf7756
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only; no push, comment, approve or merge.

## Checks and commands
- `gh pr view 755 --json headRefOid` returned the head above. Diff is 4 files: compose.local.yml, compose.traefik.yml, traefik-and-domains.md, new scripts/ci/local-overlay-loopback.test.mjs.
- `node --test scripts/ci/local-overlay-loopback.test.mjs`: 6 tests, 6 pass, 0 fail (node v26.10.0).
- Repository-wide grep for `5173`, `TASKDESK_PORT`, `compose.local`, `publishes` outside historical review/decision records, to find text still asserting the old contract.
- Read deploy.sh (compose selection comment, assert_local_port_free, assert_port_unpublished, probe_api), compose.yml header, environments.md, runbook.md, configuration-reference.md.

## What is consistent
- Mechanism is sound. Traefik reaches 5173 over the `taskdesk` network; deploy.sh `probe_api` execs wget inside the container, so no host port is needed. `TASKDESK_PORT` remains meaningful (Traefik label port, in-container probe, bind port) and its configuration-reference row ("Bind port") stays correct.
- deploy.sh production assertion (`assert_port_unpublished`) is unchanged and its logic is still right; it is now simply never expected to trip from a local overlay.
- LAN guidance introduces no new variable: it tells the operator to write their own untracked overlay with `ports: !override`. `TASKDESK_LOCAL_HTTP_PORT/HTTPS_PORT` were pre-existing. Good.
- Test reads the overlay files themselves, rejects unquoted/long-form port entries rather than passing silently, checks both address families for 80/443, and has a self-test showing the parser catches `5173:5173` and a wildcard bind. It is included by `test:ci-scripts` (`scripts/ci/**/*.test.mjs`).

## Findings
**Blocking**
1. Stale contract text now contradicts the change in five places. These are not historical records; they are the authoritative operations docs and code comments that compose.yml itself cites as the specification:
   - `docs/05-operations/deployment.md:123` table row says compose.local.yml "publishes 5173"; lines ~131-140 say "this is the overlay that publishes the port" and "The port lives in the local overlay".
   - `docs/05-operations/traefik-and-domains.md:88-89` ("publishing 5173 is the job of deploy/compose.local.yml") and `:98-99` ("Locally, 5173 being bound is the expected state").
   - `docs/05-operations/proxy-topology-evidence.md:171-172` ("only deploy/compose.local.yml publishes 5173").
   - `compose.yml:8-10` header ("Publishing 5173 is the job of deploy/compose.local.yml").
   - `scripts/deploy.sh:97-98` comment ("the local overlay is the only one that does") and the `assert_port_unpublished` failure text at ~:380 ("this usually means a local overlay was loaded"), which is now misleading advice.
   The new traefik-and-domains.md paragraph says the opposite of lines 88-99 of the same file. Fix: reword those to "no file publishes 5173; the base-file rule still matters because Compose concatenates `ports:`", and adjust the deploy.sh message.

**Non-blocking**
2. The new "Loopback only" paragraph is inserted between the port-conflict text and "`scripts/deploy.sh local` prints this. It creates a self-signed leaf certificate", so "this" no longer has a clear referent. Move the paragraph after the certificate paragraph or reword.
3. The pre-flight port check only probes `127.0.0.1`; a holder of `[::1]:80/443` is now a new way to hit the raw Docker bind error. The doc already says the check fails open to the raw error, so this is acceptable, but worth one sentence.
4. The test's `LOCAL_OVERLAYS` is a hard-coded two-file list. A future local overlay (for example a keycloak or observability overlay, both named in deployment.md but absent today) would not be covered. Suggest discovering `deploy/compose.*.yml` minus prod/uat, or asserting the list equals the set deploy.sh passes in `local` mode. Also the claim "Postgres on 5432 ... loopback" is only covered because compose.local.yml is in the list.
5. `ports: !override` needs a recent Compose (2.24.4 or later); the doc does not state the minimum.

## Residual risk
Runtime not exercised (no `docker compose config` render or live stack); judged from file contents and the unit test only. A different reviewer covers line-level correctness.

**Verdict:** REQUEST CHANGES

---
## Delta review (6cc3eebe to f17561fd)

**Reviewed head:** f17561fd8b2e52bfb7932f2a964d1ed197b783ce
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`. Delta touches compose.yml, deployment.md, proxy-topology-evidence.md, traefik-and-domains.md, deploy.sh (20 insertions, 18 deletions).
- Finding 1 (stale contract text) is resolved in every location I listed: compose.yml header, deploy.sh selection comment, deploy.sh production-assertion message (now says an overlay with a `ports:` entry for taskdesk was loaded and that no shipped overlay has one), deployment.md table, command block (now includes compose.traefik.yml, which is correct since the local stack is otherwise unreachable), and paragraph, traefik-and-domains.md lines 88-99 including the "5173 bound locally is expected" sentence, proxy-topology-evidence.md.
- Grep for `publishes 5173`, `job of deploy/compose.local`, `expected state`, `local overlay was loaded`, `overlay that publishes` outside historical records: no stale hits (the two remaining matches are the new correct wording and an unrelated static-site sentence).
- `bash -n scripts/deploy.sh`: exit 0. `node --test scripts/ci/local-overlay-loopback.test.mjs scripts/ci/install.test.mjs`: 54 tests, 54 pass, 0 fail.
- My earlier non-blocking items 2-5 (paragraph referent, `[::1]` pre-flight, hard-coded overlay list, `!override` minimum Compose) were not changed; they remain non-blocking.

**Verdict:** APPROVE

---
## Delta review 2 (f17561fd to 049aa62f)

**Reviewed head:** 049aa62fc1d83f928e83c53c62e7dbf285bb5468
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- `git diff f17561fd 049aa62f`: test file is formatting only (line wrapping, same assertions); traefik-and-domains.md now states Postgres is on `127.0.0.1:5432` and Traefik on both families, matching the overlays; the deploy.sh production-assertion message keeps "usually" and now also names host networking, which matches what `assert_containers_unpublished` checks.
- `bash -n scripts/deploy.sh`: exit 0. `node --test scripts/ci/local-overlay-loopback.test.mjs scripts/ci/install.test.mjs`: 54 tests, 54 pass, 0 fail.

**Verdict:** APPROVE
<!-- END REPORT (sha256 afc7f874be0c48dd039c4daa4727046517ce7be8bd846455ab42ff101a996948) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/755-security-opus.md; Claude Opus 5.5; sha256 659c76adc8cdbd897b94b0171314a600294dcab27428d810a675b023ab8e46af) -->
# #755 security review (Opus 5.5) — local stack listens on loopback only (#752)

**Reviewed head:** e8739ff8cff052050e3b81ed083df53eb46cb9ac
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context

Head note: the review was requested at `f17561fd8b2e52bfb7932f2a964d1ed197b783ce`. While the
review ran, the PR head moved to `e8739ff8…` with one commit, `style(ci): format the loopback
overlay test`. Its diff only re-wraps `scripts/ci/local-overlay-loopback.test.mjs`; every regex,
assertion and branch is the same. All compose, deploy-script and docs files are identical between
the two heads. The test was re-run and two mutations were re-checked at `e8739ff8…` (see below).
The verdict applies to `e8739ff8…`.

**Comparison base:** merge base `d159704be626136e728df7ddef0381dc37cf7756` (= `origin/main` at review time).

## Surfaces examined

- `compose.yml` (header comment; confirmed no `ports:` on any service)
- `deploy/compose.local.yml` (5173 publication removed; `TASKDESK_TRUST_PROXY: "1"`; Postgres `127.0.0.1:5432`)
- `deploy/compose.traefik.yml` (ports now `127.0.0.1:` and `[::1]:` for 80/443; `--api.dashboard=false`; no `forwardedHeaders` trust options)
- `deploy/compose.prod.yml`, `deploy/compose.uat.yml` (unchanged; no ports)
- `scripts/deploy.sh` (file selection per mode; `assert_port_unpublished` and its message; `probe_api` runs inside the container)
- `scripts/ci/local-overlay-loopback.test.mjs`; wiring into `pnpm test:ci-scripts` (`node --test 'scripts/ci/**/*.test.mjs'`, run by `ci-fast.yml`)
- `apps/api/src/auth.ts` / `utils/resolve-client-ip.ts` (trust-proxy is a hop count, read from the right)
- docs: `deployment.md`, `traefik-and-domains.md`, `proxy-topology-evidence.md`
- SIT evidence in `…/2026-10-15/752/`, and a fresh read-only probe of the running SIT

## Commands and results

| Command | Result |
| --- | --- |
| `gh pr view 755 --json headRefOid` (start) | `f17561fd…`; (end) `e8739ff8…` |
| `node --test scripts/ci/local-overlay-loopback.test.mjs` @f17561fd | 6 tests, 6 pass, exit 0 |
| same @e8739ff8 | 6 tests, 6 pass, exit 0 |
| `docker compose -f compose.yml -f deploy/compose.local.yml -f deploy/compose.traefik.yml config` (dummy secrets, `--env-file /dev/null`, render only) | published ports: postgres `127.0.0.1:5432`; traefik `127.0.0.1:80`, `::1:80`, `127.0.0.1:443`, `::1:443`. No `taskdesk` port, no `network_mode`. Same with `--profile s3`. |
| same with `TASKDESK_LOCAL_HTTP_PORT=8080 TASKDESK_LOCAL_HTTPS_PORT=8443 TASKDESK_PORT=9999` | traefik `127.0.0.1:8080`, `::1:8080`, `127.0.0.1:8443`, `::1:8443`; still loopback; `TASKDESK_PORT` publishes nothing |
| render `compose.yml + compose.prod.yml --profile s3`, and `+ compose.uat.yml --profile s3` | no service publishes any port |
| `docker ps` (SIT, read-only) | `taskdesk-taskdesk-1 5173/tcp` (not published); traefik loopback v4+v6 80/443; postgres `127.0.0.1:5432`; mailpit and valkey not published |
| `lsof -nP -iTCP -sTCP:LISTEN` | OrbStack listens on `*:80` and `*:443` (IPv4 and IPv6), and on `127.0.0.1:5432` |
| curl to LAN address `192.168.49.28` ports 5173, 5432, 8080, 8443, 8025, 1025, 6379, 8333 | connection refused (curl rc 7) on every one |
| curl to LAN address ports 80 / 443 | TCP connect **succeeds**, then empty reply (rc 52) on HTTP and TLS handshake aborted (rc 35) on HTTPS. No HTTP response or TLS certificate is served. |
| curl loopback v4 / v6 :443 | 404 from Traefik for an unrouted host (answers); 5173 on loopback refused (rc 7) |

### Mutation checks on the regression test (each reverted with `git checkout`)

| Mutation | Test exit |
| --- | --- |
| Traefik HTTP binding loses `127.0.0.1:` (wildcard v4) | 1 (caught) |
| Traefik HTTPS `[::1]` changed to `[::]` | 1 (caught) |
| Long-form port entry added to Traefik | 1 (caught) |
| Flow-sequence `ports: ["5173:5173"]` on `taskdesk` | 1 (caught) |
| `taskdesk` publishes `"127.0.0.1:5173:5173"` (loopback, still forbidden) | 1 (caught) |
| Postgres binding changed to `"5432:5432"` | 1 (caught) |
| Unquoted `- 8025:8025` on mailpit | 1 (caught) |
| `network_mode: host` on `taskdesk` in `compose.local.yml` | 0 (**not caught**) |
| New overlay file `deploy/compose.dev.yml` publishing 5173 | 0 (**not caught**) |
| YAML anchor/merge key (`<<: *x`) injecting a wildcard port | 0 (**not caught**) |

At `e8739ff8…`: wildcard Traefik binding → exit 1; unquoted `taskdesk` port → exit 1 (behaviour unchanged by the formatting commit).

## Answers to the security questions

1. **Remaining off-host paths.** In the rendered local config, every published port is loopback.
   The application port, Mailpit, Valkey and (with `--profile s3`) SeaweedFS publish nothing.
   `TASKDESK_LOCAL_*` only feed the host-port number; the address prefix is literal, so these
   variables cannot widen the bind address. `TASKDESK_PORT` no longer drives any publication.
   The shipped files use no `!override`/`!reset`, so Compose concatenation only adds ports; no
   shipped file adds a non-loopback one. Production and UAT renders publish nothing at all.
   The IPv6 wildcard (`[::]`) is no longer used; `[::1]` is explicit.
2. **`TASKDESK_TRUST_PROXY=1` locally.** Sound. With 5173 unpublished, Traefik is the only hop
   that can reach the application from outside the Docker network. Traefik's entrypoints set no
   `forwardedHeaders.trustedIPs`/`insecure`, so it does not trust client-supplied forwarding
   headers, and the app reads the hop count from the right. Other containers on the `taskdesk`
   network (Postgres, Valkey, Mailpit, SeaweedFS) can still reach 5173 directly; those are part
   of the trusted stack, as before.
3. **Production assertion.** `assert_port_unpublished` is unchanged in logic (fails closed on
   no container, inspect error, host networking, PublishAllPorts, any binding/mapping). Production
   still loads only `compose.yml` + `deploy/compose.prod.yml`, and the render confirms no ports.
   The new message is accurate for the common cause. See non-blocking N3 on wording.
4. **Test robustness.** Good against changes to the shipped entries (wrong address, other address
   family, long form, flow form, unquoted form, application port re-added, even on loopback). It
   does not cover new overlay files, `network_mode: host`, YAML anchors/merge keys, or the base
   `compose.yml`. See N1.

## Findings

### Blocking

None.

### Non-blocking

- **N1 — test scope is the two named files, read textually.** A new local overlay, a
  `network_mode: host` entry, or a YAML merge key can widen exposure without failing the test
  (mutations above). Production is still guarded at runtime by `assert_port_unpublished`, so the
  gap is local-only. Suggested follow-up: render the merged local config with
  `docker compose … config --format json` (dummy values) and assert on `host_ip` for every
  service and on the absence of `network_mode: host`; or glob `deploy/compose.*.yml`.
- **N2 — SIT evidence classification is inaccurate for ports 80/443.** `reachability-after.txt`
  records `LAN 80 000refused` and `LAN 443 000refused`. Re-probing shows the TCP connection to
  the LAN address on 80/443 is **accepted** by the container runtime (OrbStack listens on the
  wildcard address for these privileged ports, as `lsof` in the same file shows) and then closed
  with no HTTP or TLS response. No TaskDesk content is served, so the outcome is "not reachable",
  but it is not "refused", and enforcement here relies on the runtime's own filtering rather
  than a kernel-level loopback bind. The evidence file should say so. Only same-host probes of
  the LAN address were performed; no second-machine test exists.
- **N3 — production assertion message.** It now states that "an overlay with a `ports:` entry for
  the taskdesk service was loaded" as fact. The same failure path also fires for host networking,
  PublishAllPorts, a missing container or an inspect error; the specific reason is included in
  the parenthesis before it. The previous text hedged with "usually". Suggest restoring the hedge.
- **N4 — docs precision.** `traefik-and-domains.md` says the overlays bind every published port to
  "IPv4 `127.0.0.1` and IPv6 `[::1]`", listing Postgres; Postgres is bound to `127.0.0.1` only.
  Harmless (narrower), but inaccurate.

## Residual risk / not checked

- No test from a second machine on the LAN; reachability conclusions come from same-host probes
  of the LAN address plus the rendered config.
- On Linux hosts with older Docker Engine releases, loopback-published ports have historically
  been reachable from directly adjacent network hosts under some configurations. Current Docker
  Engine versions address this. Not tested here; it is a host-runtime property, not something
  this PR changes.
- The guidance to re-publish Traefik on another address via a personal `!override` overlay was
  read, not exercised.
- Remaining PR checks were not all green at review time (`pull request template + security review`
  fails pending this review; integration and performance pending). Not evaluated as part of this verdict.

**Verdict:** CLEAR

---

## Rebind — mechanical (Opus 5.5)

**Reviewed head:** 049aa62fc1d83f928e83c53c62e7dbf285bb5468
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), same independent review context as above

**Comparison base:** previously reviewed head `e8739ff8cff052050e3b81ed083df53eb46cb9ac`. One commit, `049aa62f docs(deploy): bind wording for postgres and keep the production-message hedge (#752 review)`. Live head confirmed with `gh pr view 755 --json headRefOid`.

| Check | Result |
| --- | --- |
| `git diff --stat e8739ff8 049aa62f` | 2 files: `docs/05-operations/traefik-and-domains.md` (+3/−2), `scripts/deploy.sh` (+4/−3) |
| `scripts/deploy.sh` diff content | Only lines inside the double-quoted `die "…"` message string of `assert_port_unpublished`; backticks are still escaped; no logic, condition or command changed |
| Docs diff content | Loopback paragraph only: Traefik on `127.0.0.1` and `[::1]`, Postgres on `127.0.0.1:5432` (resolves N4) |
| `bash -n scripts/deploy.sh` | exit 0 |
| `node --test scripts/ci/local-overlay-loopback.test.mjs` | 6 tests, 6 pass, 0 fail, exit 0 |

- N3 is resolved. The message hedges again ("usually"), and it now names host networking as a cause.
- N4 is resolved.
- I did not re-verify the coordinator's report of the N2 SIT-evidence correction for this rebind.
- N1 (test scope) is still non-blocking and open.
- Compose files and the regression test are unchanged since `e8739ff8`, so the analysis above still holds.

**Verdict:** CLEAR

---

## Rebind — merge of main `8ed5fef2` (Opus 5.5, mechanical)

**Reviewed head:** 144b01bb8bf9afaec82907181bdccc1b46f1477e
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), same independent review context as above

**Comparison base:** `b96dd7ed1f8038a3d372549ea826ce8436e6999f`. That is my CLEAR head `049aa62f` plus one commit, which adds only `docs/07-planning/security-reviews/755-local-loopback.md`.

| Check | Result |
| --- | --- |
| live head (`gh pr view 755`) | `144b01bb8bf9afaec82907181bdccc1b46f1477e` |
| parents of `144b01bb` | `b96dd7ed1f8038a3d372549ea826ce8436e6999f`, `8ed5fef24f2e43aa09ac721e3c6faedda9c45030` |
| `git diff --stat 049aa62f b96dd7ed` | 1 file: `docs/07-planning/security-reviews/755-local-loopback.md` (+314) |
| `git merge-tree --write-tree b96dd7ed 8ed5fef2` | `c98da662b1a35f5672438d60166e317a78fc933e`, equal to the tree of `144b01bb`, so the merge was clean with no hand edits |
| `git diff --stat b96dd7ed 144b01bb` | 5 docs files only: `docs/05-operations/environments.md` (+6), `docs/07-planning/{active-mission,decision-log,integration-execution-queue,pr-disposition-ledger}.md` |
| code/config paths changed since `049aa62f` (`compose.yml deploy scripts .github apps packages`) | none |
| `node --test scripts/ci/local-overlay-loopback.test.mjs` @144b01bb | 6 tests, 6 pass, 0 fail, exit 0 |

**Interaction:** none. The `environments.md` addition describes the laptop SIT as loopback-only, served on Traefik HTTPS 443, which is consistent with this PR. No compose file, deploy script or test changed.

**Verdict:** CLEAR
<!-- END REPORT (sha256 659c76adc8cdbd897b94b0171314a600294dcab27428d810a675b023ab8e46af) -->
