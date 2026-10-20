# P1–P4 Integrated Stage Review

**Date:** 2026-10-20
**Stages covered:** P1 · Core work management · P2 · Service desk · P3 · Portal and identity · P4 · Governance and administration (plus P0 screen inventory sign-off)
**Authority:** Owner directive and conditional-gate approval recorded in [`docs/07-planning/decision-log.md`](../decision-log.md#2026-10-20--p0p4-full-closure-directive-condition-gates--live-sit-verification-approved-by-thomas) and [`docs/07-planning/active-mission.md`](../active-mission.md).

This written stage review satisfies the [Definition of Done](../../04-engineering/definition-of-done.md#stage-completion) stage-completion requirements across P1, P2, P3, and P4, including what went wrong and how each conditional gate was dispositioned.

---

## 1. Scope & Summary of Delivered Capability

| Stage | Goal | Features (`✅` in `docs/03-features/README.md`) | Screens (`✅` in `screen-inventory.md`) |
| --- | --- | --- | --- |
| **P0 · Foundation** | Working, de-branded, quality-gated two-origin skeleton | Foundation gates, two-entry router, RLS prototype, policy registry | **8 / 8 `✅`** |
| **P1 · Core work** | Core work management surface (replaces Planner) | `work-items`, `views`, `projects-and-engagements`, `relations-and-hierarchy`, `comments-and-activity`, `attachments`, `search-and-saved-views`, `assignment` (8/8 `✅`) | **33 / 33 `✅`** |
| **P2 · Service desk** | ITSM ticketing & SLA/workflow/approval engine | `workflows`, `sla`, `service-calendars`, `request-types-and-catalogue`, `intake-queue`, `approvals`, `audit-trail` (7/7 `✅`) | **16 / 16 `✅`** |
| **P3 · Portal & identity** | Customer self-service portal & enterprise OIDC/SCIM | `customer-portal`, `identity-provisioning` (2/2 `✅`) | **23 / 23 `✅`** |
| **P4 · Governance** | One image, any customer, configured through God Mode & workspace settings | `roles-and-permissions-ui`, `teams`, `god-mode`, `settings-hierarchy`, `custom-fields`, `notifications`, `automations`, `webhooks-and-api-keys`, `mcp-server` (9/9 `✅`) | **29 / 29 `✅`** |
| **Total (P0–P4)** | Full service desk, portal, identity, and governance platform | **26 / 26 features `✅`** | **109 / 109 screens `✅`** (P5: 28 `⬜`, P6: 2 `⬜`) |

---

## 2. Stage-Gate & Condition-Gate Dispositions

Per Thomas's 2026-10-20 directive recorded in `decision-log.md`:

| Gate | Requirement | Disposition | Evidence |
| --- | --- | --- | --- |
| **G1–G13 (Automated UX & Build Gates)** | Token purity (`G1`), UI primitives (`G2`), computed contrast & density (`G3`), route policy (`G4`), route metadata & URL round-trip (`G5`), bundle purity (`G12`), performance (`G11`), a11y (`G6`) | **PASS (Automated)** | `pnpm check:tokens`, `pnpm check:ui`, `pnpm check:inventory`, `pnpm check:bundle-purity`, `pnpm test:permissions`, Playwright E2E + axe-core WCAG 2.2 AA |
| **H1–H6 & PG1 (Human Design & Screen Review)** | Owner review of every P0–P4 screen and integrated P4 design sign-off | **APPROVED (Conditional Gate)** | Thomas's 2026-10-20 directive + live SIT environment (`https://ticketing.localhost:8443` and `https://portal.localhost:8443`) + `/browser` visual verification |
| **PG2–PG6 (Manual SR, Keyboard, Fresh-Eyes, Cross-Browser, Realistic Data)** | Automated keyboard-only, reduced-motion, and axe-core WCAG 2.2 AA suites run now; manual voiceover/external load passes tracked under pre-`2.0.0` GA (#626) | **PASS (Automated + Conditional Gate)** | Playwright keyboard & reduced-motion tests + `decision-log.md` (2026-10-10 & 2026-10-20) |
| **P3 Live Entra Tenant Gate** | 25 SCIM/Entra acceptance tests run against deterministic local harness + conditional gate for external Entra tenant | **PASS (25/25 Harness + Conditional Gate)** | `tests/api/scim-entra-acceptance.test.ts` (25/25 green) + `decision-log.md` (2026-10-20) |
| **SIT Docker Compose & Disposable VM Verification** | Full `docker build` + `docker compose` deployment verified on host and in disposable Linux VM with seeded interactive credentials | **PASS** | `ghcr.io/thomasheinthura/taskdesk:local-dev` healthy on `:8443`, `scripts/seed-sit-users.mjs` verified |

---

## 3. What Went Wrong (Honest Retrospective)

1. **TanStack Router `createFileRoute` AST String Literal Constraint:**
   - When building the P4 Governance route files in parallel, one subagent appended `as never` inside `createFileRoute("/..." as never)`. TanStack Router's Vite plugin requires a bare string literal AST node and threw `expected route id to be a string literal`, which prevented the route tree from regenerating.
   - **Fix:** Stripped `as never` from `createFileRoute(...)` calls across all route files; `pnpm --filter @taskdesk/web build && pnpm generate:route-metadata` succeeded immediately.
2. **G3 (`check:contrast`) AST Manifest & Inherited Foreground Surface Rules:**
   - Adding `/agent/god-mode` as a parent layout route changed the TanStack Router parent chain for `/agent/god-mode/authentication`, `/agent/god-mode/users`, and `@taskdesk/ui` `Tabs`/`Select` in `packages/ui/src/styles/pairs.json`. Additionally, new screen components that used explicit `text-foreground` / `text-muted-foreground` without a same-element `bg-*` class triggered `check:contrast` unresolved-ancestor violations.
   - **Fix:** Relied on inherited semantic typography from the layout container (`index.css` `body { @apply bg-background text-foreground; }`) and `CardDescription` primitives, and synchronized the 8 route-chain entries in `packages/ui/src/styles/pairs.json`.
3. **Host-Side Seeding in `scripts/deploy.sh` (`ENOTFOUND postgres`):**
   - `scripts/deploy.sh` Step 6 invoked `pnpm seed` on the macOS host using `.env`'s internal Docker hostname `postgres:5432`, which does not resolve outside the Docker network when PostgreSQL's port is not published to the host.
   - **Fix:** Updated `scripts/deploy.sh` and added `scripts/seed-sit-users.mjs` so local SIT deployments seed deterministic interactive login accounts (`admin@taskdesk.local`, `agent@taskdesk.local`, `lead@taskdesk.local`, `customer@acme.example`) cleanly against the running PostgreSQL container.
