# Workspace dependency boundaries

These are the complete permitted workspace-package edges. `pnpm check:deps` enforces this in CI.
The executable matrix and this contract must change together. Type-only API exceptions remain
in that checker; this table grants no additional runtime edges.

| Workspace | Permitted workspace edges |
| --- | --- |
| `@taskdesk/web` | `@taskdesk/ui`, `@taskdesk/libs`, `@taskdesk/permissions`, `@taskdesk/domain` |
| `@taskdesk/api` | `@taskdesk/domain`, `@taskdesk/permissions`, `@taskdesk/plugins-contracts`, `@taskdesk/email`, `@taskdesk/libs`, `@taskdesk/importers` |
| `@taskdesk/domain` | (none) |
| `@taskdesk/permissions` | (none) |
| `@taskdesk/plugins-contracts` | (none) |
| `@taskdesk/ui` | (none) |
| `@taskdesk/libs` | (none) |
| `@taskdesk/email` | (none) |
| `@taskdesk/mcp` | (none) |
| `@taskdesk/importers` | (none) |
| `@taskdesk/typescript-config` | (none) |
| Thing | Convention | Example |
| --- | --- | --- |
| Files | kebab-case | `create-work-item.ts` |
| React components | PascalCase file matching export | `WorkItemHeader.tsx` |
| DB tables | singular snake_case | `work_item`, `sla_policy` |
| DB columns | snake_case | `created_at`, `assignee_id` |
| API paths | plural kebab-case | `/api/work-items/{id}` |
| Capabilities | `resource:action` | `work_item:assign` |
| Env vars | `TASKDESK_*` | `TASKDESK_DATABASE_URL` |
| Feature flags | `feature.<name>` | `feature.cycles` |
| Plugin ids | `<kind>.<name>` | `auth.oidc`, `storage.s3` |
