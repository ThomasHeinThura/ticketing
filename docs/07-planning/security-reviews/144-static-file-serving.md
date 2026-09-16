# Pre-merge security review — PR #144 (static file serving in the API process)

**Reviewed head:** `8dd79e48617e8905c2757e3e11a431312013ffbf`
**Base:** `origin/main` = `a76829b22b3af6c94c204d1f4bf9867b26e09929`

**Verdict: CLEAR.** No blocking findings. Three low/latent notes, none requiring a change
before merge.

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, **and for that head only.** A later commit touching anything
outside `docs/07-planning/security-reviews/` voids it. No waiver was sought or used.

**Reviewer independence.** A fresh Opus context that authored no part of the change,
in its own isolated detached worktree, removed afterward. Two ordinary Sonnet reviews (fresh,
independent contexts) preceded it and both returned PASS with only non-blocking nits; the
Opus pass did its own adversarial security work rather than re-confirming their correctness
findings.

**Classification.** `apps/api/src/index.ts` is in security-review scope per
`docs/04-engineering/ci-cd.md`'s explicit path list. No new dependency, no `package.json`/
lockfile change (confirmed via `git diff --stat origin/main...HEAD`).

---

## What was established by demonstration

| Claim | Evidence |
| --- | --- |
| **No path traversal out of the static root** | 37 handcrafted requests over raw sockets (bypassing WHATWG URL normalization) against a fixture root seeded with a symlink out, a `.env`, a `.git/config`, and an outside-root secret: `..`, `/%2e%2e/`, `..%2f`, double-encoded `%252e`, overlong UTF-8 `%c0%ae`, backslash/`%5c`, `//`, null byte, absolute-URI form — all 404 with zero leakage. Verified in the installed `@hono/node-server@1.19.17` `serve-static.mjs`: it decodes, then runs the reject-regex on the **same string** it passes to `join()` — no decode-after-check gap |
| **`/api/*` cannot be reached through the static/SPA-fallback path** | `isApiRequestPath` and Hono's router consume the identical `c.req.path`, so they cannot disagree. Probed `/API/workspace`, `//api/x`, `/api%2fx`, `/api./x`, `/x/../api/x`, `/api/x;.js`, `/api/../index.html` — every variant that fell through to static also matched no API route (worst case: the public SPA shell where a 404 used to be, no data); every variant the router matched returned `401`. Only GET/HEAD reach static; POST/PUT/TRACE/method-override all 404 |
| **Production path resolution is correct** | Verified against the real `Dockerfile`, not the PR body: `/app/apps/api/dist/index.js` → `/app/public`, matching `COPY --from=build /repo/apps/web/dist ./public`. Source maps are stripped from the image (`RUN find ./public -type f -name '*.map' -delete`) |
| **Security headers are unaffected** | `security-model.md` assigns nosniff/frameDeny/HSTS/Referrer-Policy to Traefik; `deploy/traefik/dynamic/middlewares.yml` sets them; not regressed by this change |
| **Typecheck/lint/test green, independently run** | `pnpm --filter @taskdesk/api typecheck/lint/test` — 290/290 (44 files); confirmed by both Sonnet reviewers and Opus separately, not trusted from the PR body |

---

## Findings — three, none blocking

- **LOW** — symlinks under the static root are followed out of it (verified: a seeded
  symlink served the outside-root secret). No attacker-reachable write primitive into the
  root exists today (`apps/api/src/storage/` writes only to S3 and `/app/data`, nothing
  writes to `apps/web/dist`/`public`). Matters only if a future feature ever writes
  user-controlled filenames there.
- **LOW** — dotfiles are served (`/.env`, `/.git/config` → `200` in the probe). Confirmed
  none exist under `apps/web/dist` or `apps/web/public` today. One deny-rule for a
  leading-`.` path segment (excepting `.well-known`) would close this and the symlink
  finding together.
- **LOW / latent** — `resolveStaticRoot()`'s first candidate (`../../../public` from
  `apps/api/src`) resolves to the repository's *parent* directory in the source (non-built)
  layout, not anywhere inside the repo. Harmless today (nothing exists there, and the
  production candidate resolves correctly), but it is exactly the untested function both
  ordinary reviews flagged (only the dependency-injected fixture path is exercised by the
  test suite, never the real candidate-computation logic) — worth a regression test if this
  function is touched again.

None of the three block merge; all are candidates for a small follow-up (a leading-`.`
deny-rule, a test against the real `resolveStaticRoot()` candidates) rather than a condition
of this PR.
