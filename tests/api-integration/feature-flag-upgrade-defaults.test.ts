import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { workspaceFeatureEnabled } from "../../apps/api/src/feature-flag/enforce";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

/**
 * Migration 0206 (owner decision, features.md defaults): an installation that already holds a
 * workspace keeps the four runtime-gated features it used while they were unenforced; a fresh
 * install keeps the documented default (off). The migration file itself is executed, so the test
 * checks the shipped SQL rather than a copy of it.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    currentDir,
    "../../apps/api/drizzle/0206_feature_flag_upgrade_defaults.sql",
  ),
  "utf8",
);

const UPGRADE_FLAGS = [
  "feature.calendar",
  "feature.customer_portal",
  "feature.sla",
  "feature.timeline",
] as const;

const seededRowsMigration = readFileSync(
  resolve(
    currentDir,
    "../../apps/api/drizzle/0209_feature_flag_upgrade_seeded_rows.sql",
  ),
  "utf8",
);

async function applyMigration() {
  for (const file of [migration, seededRowsMigration]) {
    for (const statement of file.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }
}

// The rows migration 0096 seeds on every installation: all four flags off, version 1, no author.
async function seedRowsAs0096() {
  await db.insert(schema.instanceFeatureFlagTable).values(
    UPGRADE_FLAGS.map((featureKey) => ({
      featureKey,
      enabled: false,
      locked: false,
      version: 1,
    })),
  );
}

async function instanceRows() {
  return db
    .select({
      key: schema.instanceFeatureFlagTable.featureKey,
      enabled: schema.instanceFeatureFlagTable.enabled,
      locked: schema.instanceFeatureFlagTable.locked,
      version: schema.instanceFeatureFlagTable.version,
    })
    .from(schema.instanceFeatureFlagTable)
    .orderBy(schema.instanceFeatureFlagTable.featureKey);
}

// The default reset pre-enables exactly these flags; this suite needs the bare defaults.
beforeEach(() => resetTestDatabase({ defaultOffFeatures: false }));

describe("0206 feature-flag upgrade defaults", () => {
  it("writes nothing on a fresh install, so the documented defaults (off) hold", async () => {
    await applyMigration();
    expect(await instanceRows()).toEqual([]);
  });

  it("keeps the four features on for an existing workspace, idempotently", async () => {
    const { workspace } = await createWorkspaceMember();
    for (const flag of UPGRADE_FLAGS)
      expect(await workspaceFeatureEnabled(flag, workspace.id)).toBe(false);

    await applyMigration();
    const rows = await instanceRows();
    expect(rows).toEqual(
      UPGRADE_FLAGS.map((key) => ({
        key,
        enabled: true,
        locked: false,
        version: 1,
      })),
    );
    for (const flag of UPGRADE_FLAGS)
      expect(await workspaceFeatureEnabled(flag, workspace.id)).toBe(true);

    await applyMigration();
    expect(await instanceRows()).toEqual(rows);
  });

  it("switches on rows still exactly as 0096 seeded them on an upgraded installation", async () => {
    const { workspace } = await createWorkspaceMember();
    await seedRowsAs0096();
    for (const flag of UPGRADE_FLAGS)
      expect(await workspaceFeatureEnabled(flag, workspace.id)).toBe(false);

    await applyMigration();
    const rows = await instanceRows();
    expect(rows).toEqual(
      UPGRADE_FLAGS.map((key) => ({
        key,
        enabled: true,
        locked: false,
        version: 2,
      })),
    );
    for (const flag of UPGRADE_FLAGS)
      expect(await workspaceFeatureEnabled(flag, workspace.id)).toBe(true);

    await applyMigration();
    expect(await instanceRows()).toEqual(rows);
  });

  it("leaves 0096's seeded rows off on a fresh install", async () => {
    await seedRowsAs0096();
    await applyMigration();
    expect((await instanceRows()).every((row) => !row.enabled)).toBe(true);
  });

  it("never overrides an administrator's explicit instance or workspace choice", async () => {
    const { workspace } = await createWorkspaceMember();
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({ featureKey: "feature.sla", enabled: false, version: 3 });
    await db.insert(schema.workspaceFeatureFlagTable).values({
      workspaceId: workspace.id,
      featureKey: "feature.timeline",
      enabled: false,
    });

    await applyMigration();
    const [sla] = await db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        version: schema.instanceFeatureFlagTable.version,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.sla"));
    expect(sla).toEqual({ enabled: false, version: 3 });
    expect(await workspaceFeatureEnabled("feature.sla", workspace.id)).toBe(
      false,
    );
    expect(
      await workspaceFeatureEnabled("feature.timeline", workspace.id),
    ).toBe(false);
    expect(
      await workspaceFeatureEnabled("feature.calendar", workspace.id),
    ).toBe(true);
    expect(
      await workspaceFeatureEnabled("feature.customer_portal", workspace.id),
    ).toBe(true);
  });
});
