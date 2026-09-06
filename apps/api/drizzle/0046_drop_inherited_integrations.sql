-- Issue #6 — drop the inherited kaneo integration tables.
--
-- Order matters, and drizzle-kit generated it wrong: it emitted the
-- `DROP TABLE ... CASCADE` statements first, which already removes
-- external_link's foreign key, and then tried to drop that same constraint
-- explicitly — which fails with 42704 "constraint does not exist".
--
-- So external_link is detached FIRST, then the tables go. `external_link`
-- itself is deliberately kept: it is the reserved extension point for
-- `feature.dev_links` (plugin-architecture.md), and TaskDesk's own schema
-- identifies the remote system with a `system` column rather than a foreign
-- key into a per-project integration row.
ALTER TABLE "external_link" DROP CONSTRAINT IF EXISTS "external_link_integration_id_integration_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "external_link_integrationId_idx";--> statement-breakpoint
ALTER TABLE "external_link" DROP COLUMN IF EXISTS "integration_id";--> statement-breakpoint
DROP TABLE IF EXISTS "github_integration" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "integration" CASCADE;
