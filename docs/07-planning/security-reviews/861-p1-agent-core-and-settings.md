# Security review — PR #861 (P1 agent core destinations, project overview, and canonical settings routes)

- **PR:** #861
- **Reviewed commit:** `b97af570e5cce39778ad07c81a2fef053e3356a5`
- **Reviewed tree:** `cfd3f8c79ca302351584c418288875a61b64cf10`
- **Comparison base:** `98c950853bd0a6a12f1379282909100e7c85772d` (`main`)
- **Reviewer:** Independent Critical & Security Reviewer (`Gemini 4 Argon`)
- **Date:** 2026-10-19
- **Verdict:** `PASS`

## Scope

- `apps/web/src/lib/routes.ts`
- `apps/web/src/lib/routes.test.ts`
- `apps/web/src/lib/generated-route-metadata.ts`
- `apps/web/src/components/agent/p1-core-and-settings.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/{inbox,my-work,search,settings}.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/{canned-responses,danger,labels,members,profile,states}.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/appearance.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/projects/$projectKey.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/projects/$projectKey/settings.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/projects/$projectKey/settings/{danger,labels,members,states}.tsx`
- `docs/02-design/screen-inventory.md`
- `apps/web/e2e/visual-screens.json`
- `apps/web/e2e/visual.spec.ts`
- `packages/ui/src/styles/pairs.json`

## Security verification

1. **Authenticated agent route placement (`G13`):** All 18 P1 routes are mounted exclusively under `apps/web/src/routes/agent/_layout/_authenticated/`, ensuring unauthenticated visitors and customer-portal sessions cannot access agent workspace, project, or settings screens.
2. **URL state parsing and bounds (`G5`):** `parseAgentInboxSearch`, `parseAgentMyWorkSearch`, `parseAgentGlobalSearch`, and `parseSettingsTextFilterSearch` validate enum domains (`filter`, `lens`, `scope`), bound search queries (`q` <= 200 chars), delegate `?item=` validation to `parseWorkItemQueryState`, and fail closed to safe defaults on malformed inputs.
3. **Destructive action safeguards (`pending_action`):** Workspace and project danger-zone routes (`/agent/settings/danger` and `/agent/projects/{key}/settings/danger`) enforce exact slug/key confirmation before enabling deletion requests and surface the 30-day recovery window and pending-action governance.
4. **Design-system and token discipline (`G1`–`G3`):** Uses only `@taskdesk/ui` primitives and verified token contrast pairs (`418` pairs in `packages/ui/src/styles/pairs.json`).

## Findings

None.
