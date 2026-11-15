// D-E (12 Nov): limited custom actors preserve role-override and reach denials.
/**
 * #750: a key's identity carries its STORED capability scope on the project-reach routes.
 *
 * `resolveCallerIdentity` used to build a key identity with no capability subset, so
 * `can()` refused every key on a route that evaluates the project capability itself
 * (`GET /api/project/{id}`) while the owner's session got 200. The key now holds exactly
 * `owner authority ∩ stored scope`; a null, malformed or insufficient scope still holds
 * nothing, and a key never exceeds the authority of its owner in the project.
 */
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPersonalApiKey,
  createServiceApiKey,
} from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { currentWorkspaceReachPredicate } from "../../apps/api/src/database/repositories/identity-scope.repository";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { createApp } from "../../apps/api/src/index";
import { resolveServicePrincipal } from "../../apps/api/src/permissions/service-principal";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { ensureAgentSession } from "./helpers/pending-deletion";
import {
  addCanonicalMember,
  addMember,
  addProjectLimitedMember,
  json,
  makeApiKey,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

async function getProject(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
) {
  return json(app, "GET", `/api/project/${projectId}`);
}

describe("API integration: API-key identity carries its stored capability scope (#750)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  async function arrange() {
    const world = await setupWorld();
    const { app } = createApp();
    return { world, app };
  }

  it("the owner's session reads the project (baseline)", async () => {
    const { world, app } = await arrange();
    mockAuthenticatedSession(world.projectMember.user);
    expect((await getProject(app, world.project.id)).status).toBe(200);
  });

  it("a key scoped to project:read succeeds where its owner's session succeeds", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    for (const permissions of [
      { project: ["read"] },
      { project: ["read"], work_item: ["read"] },
      { project: ["read", "update"], work_item: ["read", "update"] },
    ]) {
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, permissions),
      });
      const response = await getProject(app, world.project.id);
      expect(response.status, await response.text()).toBe(200);
    }
  });

  it("a null, malformed or insufficient stored scope is still refused (fail closed)", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    const refused: unknown[] = [
      null,
      { project: "read" },
      { project: [1] },
      // Valid and malformed together: nothing is granted, not even the valid part.
      { project: ["read"], work_item: [1] },
      { work_item: [1], project: ["read"] },
      { project: ["read"], work_item: "read" },
      { project: [["read"]] },
      {},
      { work_item: ["read"] },
      { workspace: ["read"] },
      { project: ["not_a_capability"] },
      { unknown_resource: ["read"] },
    ];
    for (const permissions of refused) {
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, permissions),
      });
      const response = await getProject(app, world.project.id);
      expect(
        response.status,
        `${JSON.stringify(permissions)}: ${await response.text()}`,
      ).toBe(403);
    }
  });

  it("a key never exceeds its owner: a scope the owner lacks in the project is refused like the session", async () => {
    const { world, app } = await arrange();
    const owner = await addProjectLimitedMember(world.workspaceId);
    // The owner reaches the project but holds no project:read through its role.
    await grantProjectRole(owner.user.id, world.project.id, ["work_item:read"]);
    mockAuthenticatedSession(owner.user);
    expect((await getProject(app, world.project.id)).status).toBe(403);

    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(owner.user.id, {
        project: ["read", "update", "delete", "manage_settings"],
        work_item: ["read"],
      }),
    });
    expect((await getProject(app, world.project.id)).status).toBe(403);
  });

  it("a fully scoped key owned by someone outside project reach is still a 404", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.outsiderLead.user.id, {
        project: ["read"],
        work_item: ["read"],
      }),
    });
    expect((await getProject(app, world.project.id)).status).toBe(404);
  });

  it("a disabled key is refused outright, whatever its scope", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    const raw = await makeApiKey(world.projectMember.user.id, {
      project: ["read"],
    });
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.userId, world.projectMember.user.id));
    setAmbientHeaders({ "x-api-key": raw });
    const response = await getProject(app, world.project.id);
    expect(response.status, await response.text()).toBe(401);
  });

  it("a scope that implies read (project:update) holds read, exactly as for a session role", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.projectMember.user.id, {
        project: ["update"],
      }),
    });
    expect((await getProject(app, world.project.id)).status).toBe(200);
  });

  it("a null or mixed-malformed scope is refused on a second project-reach route too (not only GET /api/project/{id})", async () => {
    const { world, app } = await arrange();
    mockAnonymousSession();
    for (const permissions of [null, { project: ["read"], work_item: [1] }]) {
      setAmbientHeaders({
        "x-api-key": await makeApiKey(world.projectMember.user.id, permissions),
      });
      const response = await json(
        app,
        "GET",
        `/api/project/${world.project.id}/milestones`,
      );
      expect(response.status, JSON.stringify(permissions)).toBe(403);
    }
    // Control: a valid scope reads the same route.
    setAmbientHeaders({
      "x-api-key": await makeApiKey(world.projectMember.user.id, {
        project: ["read"],
      }),
    });
    const ok = await json(
      app,
      "GET",
      `/api/project/${world.project.id}/milestones`,
    );
    expect(ok.status, await ok.text()).toBe(200);
  });
});

describe("API integration: canonical API-key scopes & archive/settings/label route matrix (H-3 / H-5, D-S)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    for (const featureKey of ["feature.mcp", "feature.cycles"]) {
      await db
        .insert(schema.instanceFeatureFlagTable)
        .values({ featureKey, enabled: true })
        .onConflictDoUpdate({
          target: schema.instanceFeatureFlagTable.featureKey,
          set: { enabled: true },
        });
    }
    invalidateFeatureFlagCache();
  });

  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  async function mintKey(
    userId: string,
    capabilities: string[],
    isMcp = false,
  ): Promise<string> {
    const created = await createPersonalApiKey(
      { userId },
      {
        name: `${isMcp ? "mcp" : "personal"}-${capabilities.join(",")}`,
        capabilities,
        isMcp,
      },
    );
    return created.key;
  }

  async function currentVersions(workspaceId: string, projectId: string) {
    const [workspace] = await db
      .select({ version: schema.workspaceTable.projectSettingsVersion })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    const [project] = await db
      .select({ version: schema.projectTable.projectSettingsVersion })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId));
    return {
      expectedWorkspaceVersion: workspace?.version ?? 0,
      expectedProjectVersion: project?.version ?? 0,
    };
  }

  it.each([
    ["personal API key", false],
    ["MCP key", true],
  ] as const)(
    "enforces distinct project:update, project:manage_settings, and project:archive scopes across the mounted project settings matrix for %s",
    async (_kind, isMcp) => {
      const admin = await createWorkspaceMember({ role: "admin" });
      await seedWorkspaceDefaults(admin.workspace.id);
      const { project, columns } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      await grantProjectRole(admin.user.id, project.id, [
        "project:read",
        "project:update",
        "project:manage_settings",
        "project:archive",
      ]);

      const templates = await db
        .select({ id: schema.stateTemplateTable.id })
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, admin.workspace.id));
      const templateA = requireRow(templates, "stateTemplate A");
      const templateB = requireRow(templates.slice(1), "stateTemplate B");

      mockAnonymousSession();
      const { app } = createApp();

      const updateKey = await mintKey(admin.user.id, ["project:update"], isMcp);
      const settingsOnlyKey = await mintKey(
        admin.user.id,
        ["project:manage_settings"],
        isMcp,
      );
      const settingsAndUpdateKey = await mintKey(
        admin.user.id,
        ["project:manage_settings", "project:update"],
        isMcp,
      );
      const archiveOnlyKey = await mintKey(
        admin.user.id,
        ["project:archive"],
        isMcp,
      );
      const archiveAndUpdateKey = await mintKey(
        admin.user.id,
        ["project:archive", "project:update"],
        isMcp,
      );

      const baseUpdateBody = {
        name: "Updated project name",
        icon: project.icon ?? "Layout",
        slug: project.slug,
        description: "General project update",
      };

      // 1. General project update (`PUT /api/project/:id` & `PATCH /api/project/:id/health`):
      //    `project:update` succeeds; `project:manage_settings` or `project:archive` alone does not substitute.
      setAmbientHeaders({ "x-api-key": settingsOnlyKey });
      expect(
        (await json(app, "PUT", `/api/project/${project.id}`, baseUpdateBody))
          .status,
      ).toBe(403);
      expect(
        (
          await json(app, "PATCH", `/api/project/${project.id}/health`, {
            health: "green",
          })
        ).status,
      ).toBe(403);

      setAmbientHeaders({ "x-api-key": archiveOnlyKey });
      expect(
        (await json(app, "PUT", `/api/project/${project.id}`, baseUpdateBody))
          .status,
      ).toBe(403);

      setAmbientHeaders({ "x-api-key": updateKey });
      expect(
        (await json(app, "PUT", `/api/project/${project.id}`, baseUpdateBody))
          .status,
      ).toBe(200);
      expect(
        (
          await json(app, "PATCH", `/api/project/${project.id}/health`, {
            health: "green",
          })
        ).status,
      ).toBe(200);

      // 2. Mounted `project:manage_settings` route matrix:
      //    a) Canonical-only `project:manage_settings` routes (`settingsOnlyKey` -> 200;
      //       `updateKey`, `archiveOnlyKey`, `archiveAndUpdateKey` -> 403):
      //       - `PATCH /api/projects/{projectId}/settings/inheritance`
      //       - `POST  /api/projects/{projectId}/states`
      //       - `PATCH /api/projects/{projectId}/states/{stateId}`
      //       - `PATCH /api/projects/{projectId}/state-set`
      //       - `PUT   /api/project/{id}/contract`
      //       - `GET   /api/projects/{projectId}/features`
      //       - `PATCH /api/projects/{projectId}/features`
      //       - `PATCH /api/projects/{key}/agile-settings`
      //    b) Legacy-scoped `project:manage_settings` routes that ALSO run
      //       `requireApiKeyPermissionScope({ project: ["update"] })` (`settingsOnlyKey` -> 403;
      //       `settingsAndUpdateKey` -> 200):
      //       - `PUT  /api/project/{id}` (when mutating settings fields)
      //       - `POST /api/column/{projectId}`
      //       - `PUT  /api/workflow-rule/{projectId}` (`DELETE /api/workflow-rule/{id}` is `sessionOnly`)
      const v1 = await currentVersions(admin.workspace.id, project.id);
      const canonicalSettingsProbes = [
        [
          "PATCH /api/projects/{projectId}/settings/inheritance",
          () =>
            json(
              app,
              "PATCH",
              `/api/projects/${project.id}/settings/inheritance`,
              { ...v1, slaPolicy: { mode: "inherit" as const } },
            ),
        ],
        [
          "POST /api/projects/{projectId}/states",
          () =>
            json(app, "POST", `/api/projects/${project.id}/states`, {
              stateTemplateId: templateA.id,
            }),
        ],
        [
          "PATCH /api/projects/{projectId}/state-set",
          async () =>
            json(app, "PATCH", `/api/projects/${project.id}/state-set`, {
              ...(await currentVersions(admin.workspace.id, project.id)),
              mode: "inherit" as const,
            }),
        ],
        [
          "PUT /api/project/{id}/contract",
          () =>
            json(app, "PUT", `/api/project/${project.id}/contract`, {
              startDate: "2026-01-01",
              endDate: "2026-12-31",
              contractedMinutes: 6000,
              coverage: "9x5",
              kickoffStatus: "completed",
            }),
        ],
        [
          "GET /api/projects/{projectId}/features",
          () => json(app, "GET", `/api/projects/${project.id}/features`),
        ],
        [
          "PATCH /api/projects/{projectId}/features",
          () =>
            json(app, "PATCH", `/api/projects/${project.id}/features`, {
              changes: [{ key: "feature.automations", enabled: null }],
            }),
        ],
        [
          "PATCH /api/projects/{key}/agile-settings",
          () =>
            json(app, "PATCH", `/api/projects/${project.slug}/agile-settings`, {
              incompletePolicy: "backlog",
            }),
        ],
      ] as const;

      for (const [deniedName, deniedKey] of [
        ["project:update", updateKey],
        ["project:archive", archiveOnlyKey],
        ["project:archive+update", archiveAndUpdateKey],
      ] as const) {
        setAmbientHeaders({ "x-api-key": deniedKey });
        for (const [routeLabel, call] of canonicalSettingsProbes) {
          const res = await call();
          expect(res.status, `${deniedName} on ${routeLabel}`).toBe(403);
        }
      }

      // `settingsOnlyKey` (`project:manage_settings`) succeeds across all canonical settings routes,
      // including `POST .../states`, `PATCH .../states/{stateId}`, and `PATCH .../state-set`.
      setAmbientHeaders({ "x-api-key": settingsOnlyKey });
      for (const [routeLabel, call] of canonicalSettingsProbes) {
        if (routeLabel === "PATCH /api/projects/{projectId}/state-set") {
          // Tested after creating & reordering project states below so `override -> inherit` runs too.
          continue;
        }
        const res = await call();
        expect(
          res.status,
          `settingsOnly on ${routeLabel}: ${await res.clone().text()}`,
        ).toBe(200);
      }

      // Add a second active state so `PATCH /api/projects/{projectId}/states/{stateId}` reorders a
      // multi-state override set, verify non-settings keys are 403 on `PATCH .../states/{stateId}`,
      // then verify `settingsOnlyKey` succeeds on both `PATCH .../states/{stateId}` and `PATCH .../state-set`.
      const secondStateCreateRes = await json(
        app,
        "POST",
        `/api/projects/${project.id}/states`,
        { stateTemplateId: templateB.id },
      );
      expect(
        secondStateCreateRes.status,
        await secondStateCreateRes.clone().text(),
      ).toBe(200);
      const activeStatesAfterSecond =
        (await secondStateCreateRes.json()) as Array<{ id: string }>;
      const secondStateCreated = requireRow(
        activeStatesAfterSecond.slice(1),
        "second project state",
      );

      for (const [deniedName, deniedKey] of [
        ["project:update", updateKey],
        ["project:archive", archiveOnlyKey],
        ["project:archive+update", archiveAndUpdateKey],
      ] as const) {
        setAmbientHeaders({ "x-api-key": deniedKey });
        const deniedPatchState = await json(
          app,
          "PATCH",
          `/api/projects/${project.id}/states/${secondStateCreated.id}`,
          { position: 0, isDefault: true },
        );
        expect(
          deniedPatchState.status,
          `${deniedName} on PATCH /api/projects/{projectId}/states/{stateId}`,
        ).toBe(403);
      }

      setAmbientHeaders({ "x-api-key": settingsOnlyKey });
      const patchStateRes = await json(
        app,
        "PATCH",
        `/api/projects/${project.id}/states/${secondStateCreated.id}`,
        { position: 0, isDefault: true },
      );
      expect(patchStateRes.status, await patchStateRes.clone().text()).toBe(
        200,
      );

      const inheritStateSetRes = await json(
        app,
        "PATCH",
        `/api/projects/${project.id}/state-set`,
        {
          ...(await currentVersions(admin.workspace.id, project.id)),
          mode: "inherit" as const,
        },
      );
      expect(
        inheritStateSetRes.status,
        await inheritStateSetRes.clone().text(),
      ).toBe(200);

      // Dual-gate settings routes (`project:manage_settings` + literal `project:update` legacy scope):
      const dualSettingsProbes = [
        [
          "PUT /api/project/{id} (settings fields)",
          () =>
            json(app, "PUT", `/api/project/${project.id}`, {
              ...baseUpdateBody,
              defaultCommentVisibility: "public",
            }),
        ],
        [
          "POST /api/column/{projectId}",
          () =>
            json(app, "POST", `/api/column/${project.id}`, {
              name: `QA-${isMcp ? "mcp" : "key"}`,
            }),
        ],
        [
          "PUT /api/workflow-rule/{projectId}",
          () =>
            json(app, "PUT", `/api/workflow-rule/${project.id}`, {
              integrationType: "github",
              eventType: "pull_request.opened",
              columnId: columns.inProgress.id,
            }),
        ],
      ] as const;

      for (const [deniedName, deniedKey] of [
        ["project:update", updateKey],
        ["project:archive", archiveOnlyKey],
        ["project:archive+update", archiveAndUpdateKey],
        ["project:manage_settings-only", settingsOnlyKey],
      ] as const) {
        setAmbientHeaders({ "x-api-key": deniedKey });
        for (const [routeLabel, call] of dualSettingsProbes) {
          const res = await call();
          expect(res.status, `${deniedName} on ${routeLabel}`).toBe(403);
        }
      }

      setAmbientHeaders({ "x-api-key": settingsAndUpdateKey });
      let createdWorkflowRuleId = "";
      for (const [routeLabel, call] of dualSettingsProbes) {
        const res = await call();
        expect(
          res.status,
          `settings+update on ${routeLabel}: ${await res.clone().text()}`,
        ).toBe(200);
        if (routeLabel === "PUT /api/workflow-rule/{projectId}") {
          createdWorkflowRuleId = ((await res.json()) as { id: string }).id;
        }
      }
      // `DELETE /api/workflow-rule/{id}` is deliberately `sessionOnly: true` (pending-action deletion).
      const deleteRuleRes = await json(
        app,
        "DELETE",
        `/api/workflow-rule/${createdWorkflowRuleId}`,
      );
      expect(deleteRuleRes.status).toBe(403);
      await expect(deleteRuleRes.text()).resolves.toContain("session_required");

      // 3. Project archive / unarchive / restore (`PUT /api/project/:id/archive|unarchive|restore`):
      //    requires `project:archive` AND literal `project:update`; neither `project:update` alone
      //    nor `project:manage_settings + project:update` nor `project:archive` alone is accepted.
      for (const deniedKey of [
        updateKey,
        settingsAndUpdateKey,
        archiveOnlyKey,
      ]) {
        setAmbientHeaders({ "x-api-key": deniedKey });
        expect(
          (await json(app, "PUT", `/api/project/${project.id}/archive`)).status,
        ).toBe(403);
        expect(
          (await json(app, "PUT", `/api/project/${project.id}/unarchive`))
            .status,
        ).toBe(403);
      }

      setAmbientHeaders({ "x-api-key": archiveAndUpdateKey });
      expect(
        (await json(app, "PUT", `/api/project/${project.id}/archive`)).status,
      ).toBe(200);
      expect(
        (await json(app, "PUT", `/api/project/${project.id}/unarchive`)).status,
      ).toBe(200);

      // Soft-delete the project within its 30-day restore window and verify `PUT /api/project/:id/restore`.
      const deletedAt = new Date();
      const purgeAfter = new Date(
        deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
      );
      await db
        .update(schema.projectTable)
        .set({ deletedAt, purgeAfter })
        .where(eq(schema.projectTable.id, project.id));

      for (const deniedKey of [
        updateKey,
        settingsAndUpdateKey,
        archiveOnlyKey,
      ]) {
        setAmbientHeaders({ "x-api-key": deniedKey });
        expect(
          (await json(app, "PUT", `/api/project/${project.id}/restore`)).status,
        ).toBe(403);
      }

      setAmbientHeaders({ "x-api-key": archiveAndUpdateKey });
      expect(
        (await json(app, "PUT", `/api/project/${project.id}/restore`)).status,
      ).toBe(200);
    },
  );

  it("intersects key scope with owner role and project reach on archive/restore and settings routes", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const workspaceId = admin.workspace.id;
    await seedWorkspaceDefaults(workspaceId);
    const { project } = await createProjectFixture({ workspaceId });

    const templates = await db
      .select({ id: schema.stateTemplateTable.id })
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.workspaceId, workspaceId));
    const seededTemplate = requireRow(templates, "seededTemplate");
    const unusedTemplate = requireRow(templates.slice(1), "unusedTemplate");
    const seededState = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: seededTemplate.id,
          position: 0,
          isDefault: true,
        })
        .returning(),
      "seededState",
    );

    // `lead` holds `project:update` in canonical RBAC, NOT `project:archive` or `project:manage_settings`.
    const lead = await addCanonicalMember(workspaceId, "lead");
    await grantProjectRole(lead.user.id, project.id, [
      "project:read",
      "project:update",
    ]);

    // Out-of-reach actor: holds no reach to `project`.
    const outsider = await addProjectLimitedMember(workspaceId);

    mockAnonymousSession();
    const { app } = createApp();
    const versions = await currentVersions(workspaceId, project.id);

    for (const isMcp of [false, true]) {
      const leadFullKey = await mintKey(
        lead.user.id,
        [
          "project:read",
          "project:update",
          "project:manage_settings",
          "project:archive",
        ],
        isMcp,
      );
      setAmbientHeaders({ "x-api-key": leadFullKey });

      // Lead's key can perform general update (`project:update`), but owner lacks `project:manage_settings` & `project:archive`.
      expect(
        (
          await json(app, "PUT", `/api/project/${project.id}`, {
            name: "Lead general update",
            icon: project.icon ?? "Layout",
            slug: project.slug,
            description: "Allowed",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await json(
            app,
            "PATCH",
            `/api/projects/${project.id}/settings/inheritance`,
            { ...versions, slaPolicy: { mode: "inherit" } },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await json(app, "PATCH", `/api/projects/${project.id}/state-set`, {
            ...versions,
            mode: "inherit",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await json(app, "POST", `/api/projects/${project.id}/states`, {
            stateTemplateId: unusedTemplate.id,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await json(
            app,
            "PATCH",
            `/api/projects/${project.id}/states/${seededState.id}`,
            { position: 0, isDefault: true },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await json(app, "PUT", `/api/project/${project.id}`, {
            name: "Lead settings attempt",
            icon: project.icon ?? "Layout",
            slug: project.slug,
            description: "Denied",
            defaultCommentVisibility: "public",
          })
        ).status,
      ).toBe(403);
      expect(
        (await json(app, "PUT", `/api/project/${project.id}/archive`)).status,
      ).toBe(403);

      // Out-of-reach owner gets 404 across update, settings, archive, and restore.
      const outsiderFullKey = await mintKey(
        outsider.user.id,
        [
          "project:read",
          "project:update",
          "project:manage_settings",
          "project:archive",
        ],
        isMcp,
      );
      setAmbientHeaders({ "x-api-key": outsiderFullKey });
      expect(
        (
          await json(app, "PUT", `/api/project/${project.id}`, {
            name: "Outsider update",
            icon: project.icon ?? "Layout",
            slug: project.slug,
            description: "Hidden",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await json(
            app,
            "PATCH",
            `/api/projects/${project.id}/settings/inheritance`,
            { ...versions, slaPolicy: { mode: "inherit" } },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await json(app, "PATCH", `/api/projects/${project.id}/state-set`, {
            ...versions,
            mode: "inherit",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await json(app, "POST", `/api/projects/${project.id}/states`, {
            stateTemplateId: unusedTemplate.id,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await json(
            app,
            "PATCH",
            `/api/projects/${project.id}/states/${seededState.id}`,
            { position: 0, isDefault: true },
          )
        ).status,
      ).toBe(404);
      expect(
        (await json(app, "PUT", `/api/project/${project.id}/archive`)).status,
      ).toBe(404);
    }

    // Also verify lead 403 and outsider 404 on `PUT /api/project/:id/restore` when soft-deleted.
    const deletedAt = new Date();
    await db
      .update(schema.projectTable)
      .set({
        deletedAt,
        purgeAfter: new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      })
      .where(eq(schema.projectTable.id, project.id));

    setAmbientHeaders({
      "x-api-key": await mintKey(lead.user.id, [
        "project:archive",
        "project:update",
      ]),
    });
    expect(
      (await json(app, "PUT", `/api/project/${project.id}/restore`)).status,
    ).toBe(403);

    setAmbientHeaders({
      "x-api-key": await mintKey(outsider.user.id, [
        "project:archive",
        "project:update",
      ]),
    });
    expect(
      (await json(app, "PUT", `/api/project/${project.id}/restore`)).status,
    ).toBe(404);
  });

  it("allows canonical label:manage keys on legacy label statement gates while keeping legacy label:create unilateral (H-5)", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    // Seed a pure `viewer` member who lacks `label:manage`.
    const viewerUser = await createWorkspaceMember({ role: "viewer" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: viewerUser.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    await db
      .insert(schema.workspaceRoleTable)
      .values({
        workspaceId: admin.workspace.id,
        role: "viewer",
        permission: JSON.stringify({
          workspace: ["read"],
          project: ["read"],
          label: ["read"],
        }),
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });
    await grantProjectRole(admin.user.id, project.id, [
      "project:read",
      "project:update",
    ]);

    mockAnonymousSession();
    const { app } = createApp();

    // 1. Both personal API keys (`isMcp: false`) and MCP keys (`isMcp: true`) with canonical
    //    `label:manage` satisfy `POST /api/label`, `PUT /api/label/:id`, `DELETE /api/label/:id`,
    //    and canonical `POST /api/label/project/:projectId/catalogue`.
    for (const [suffix, isMcp] of [
      ["personal", false],
      ["mcp", true],
    ] as const) {
      setAmbientHeaders({
        "x-api-key": await mintKey(admin.user.id, ["label:manage"], isMcp),
      });

      const createdRes = await json(app, "POST", "/api/label", {
        workspaceId: admin.workspace.id,
        name: `canonical-${suffix}`,
        color: "#2563EB",
      });
      expect(createdRes.status, await createdRes.clone().text()).toBe(200);
      const created = (await createdRes.json()) as { id: string };

      const updatedRes = await json(app, "PUT", `/api/label/${created.id}`, {
        name: `canonical-${suffix}-edited`,
        color: "#1D4ED8",
      });
      expect(updatedRes.status, await updatedRes.clone().text()).toBe(200);

      const projectLabelRes = await json(
        app,
        "POST",
        `/api/label/project/${project.id}/catalogue`,
        { name: `proj-${suffix}`, color: "#10B981" },
      );
      expect(projectLabelRes.status, await projectLabelRes.clone().text()).toBe(
        200,
      );

      const deleteRes = await json(app, "DELETE", `/api/label/${created.id}`);
      expect(deleteRes.status, await deleteRes.clone().text()).toBe(202);
    }

    // 2. Read-only key (`workspace:read`) satisfies `GET /api/label/workspace/:workspaceId`
    //    (`label:read -> workspace:read` in `LEGACY_PAIR_CAPABILITY`), and is refused on all writes.
    for (const isMcp of [false, true]) {
      setAmbientHeaders({
        "x-api-key": await mintKey(admin.user.id, ["workspace:read"], isMcp),
      });
      const listRes = await json(
        app,
        "GET",
        `/api/label/workspace/${admin.workspace.id}`,
      );
      expect(listRes.status, await listRes.clone().text()).toBe(200);
      expect(
        (
          await json(app, "POST", "/api/label", {
            workspaceId: admin.workspace.id,
            name: "readonly-denied",
            color: "#EF4444",
          })
        ).status,
      ).toBe(403);
    }

    // 3. Owner lacking `label:manage` (`viewer`) is refused even if key carries `label:manage`.
    setAmbientHeaders({
      "x-api-key": await mintKey(viewerUser.user.id, ["label:manage"]),
    });
    expect(
      (
        await json(app, "POST", "/api/label", {
          workspaceId: admin.workspace.id,
          name: "viewer-denied",
          color: "#EF4444",
        })
      ).status,
    ).toBe(403);

    // 4. Legacy granular `{ label: ["create"] }` key satisfies literal `POST /api/label` ONLY;
    //    it never widens to `PUT /api/label/:id`, `DELETE /api/label/:id`, or canonical `label:manage`
    //    (`POST /api/label/project/:projectId/catalogue`).
    setAmbientHeaders({
      "x-api-key": await makeApiKey(admin.user.id, {
        label: ["create"],
        project: ["read"],
      }),
    });
    const legacyCreatedRes = await json(app, "POST", "/api/label", {
      workspaceId: admin.workspace.id,
      name: "legacy-create-only",
      color: "#F59E0B",
    });
    expect(legacyCreatedRes.status, await legacyCreatedRes.clone().text()).toBe(
      200,
    );
    const legacyCreated = (await legacyCreatedRes.json()) as { id: string };

    expect(
      (
        await json(app, "PUT", `/api/label/${legacyCreated.id}`, {
          name: "legacy-update-denied",
          color: "#F59E0B",
        })
      ).status,
    ).toBe(403);
    expect(
      (await json(app, "DELETE", `/api/label/${legacyCreated.id}`)).status,
    ).toBe(403);
    expect(
      (
        await json(app, "POST", `/api/label/project/${project.id}/catalogue`, {
          name: "legacy-widen-denied",
          color: "#F59E0B",
        })
      ).status,
    ).toBe(403);
  });

  it("enforces workspace service-key boundaries across project and label routes", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await seedWorkspaceDefaults(owner.workspace.id);
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [template] = await db
      .select({ id: schema.stateTemplateTable.id })
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.workspaceId, owner.workspace.id))
      .limit(1);
    const serviceKey = await createServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      {
        name: "w12-service-key",
        capabilities: [
          "workspace:read",
          "label:manage",
          "project:read",
          "project:update",
          "project:manage_settings",
          "project:archive",
        ],
      },
    );
    const readOnlyServiceKey = await createServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      { name: "w12-readonly-service-key", capabilities: ["workspace:read"] },
    );

    mockAnonymousSession();
    const { app } = createApp();
    const versions = await currentVersions(owner.workspace.id, project.id);

    // Row-addressed project routes always answer 404 for service keys (no project reach).
    setAmbientHeaders({ "x-api-key": serviceKey.key });
    expect(
      (
        await json(app, "PUT", `/api/project/${project.id}`, {
          name: "Service update",
          icon: project.icon ?? "Layout",
          slug: project.slug,
          description: "No project reach",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await json(
          app,
          "PATCH",
          `/api/projects/${project.id}/settings/inheritance`,
          { ...versions, slaPolicy: { mode: "inherit" } },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await json(app, "PATCH", `/api/projects/${project.id}/state-set`, {
          ...versions,
          mode: "inherit",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await json(app, "POST", `/api/projects/${project.id}/states`, {
          stateTemplateId: template?.id ?? "missing-template",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await json(
          app,
          "PATCH",
          `/api/projects/${project.id}/states/missing-state`,
          { position: 0 },
        )
      ).status,
    ).toBe(404);
    expect(
      (await json(app, "PUT", `/api/project/${project.id}/archive`)).status,
    ).toBe(404);
    expect(
      (await json(app, "PUT", `/api/project/${project.id}/unarchive`)).status,
    ).toBe(404);
    expect(
      (await json(app, "PUT", `/api/project/${project.id}/restore`)).status,
    ).toBe(404);

    // Workspace-addressed `POST /api/label` (`label:create -> label:manage`) succeeds for the
    // service key, while project-reach-filtered `GET /api/label/workspace/:workspaceId` (`requireReachFilteredList`
    // rejects non-person principals with 401) and row-addressed `PUT`/`DELETE /api/label/:id` (404) are refused.
    expect(
      (await json(app, "GET", `/api/label/workspace/${owner.workspace.id}`))
        .status,
    ).toBe(401);
    const labelRes = await json(app, "POST", "/api/label", {
      workspaceId: owner.workspace.id,
      name: "service-created-label",
      color: "#8B5CF6",
    });
    expect(labelRes.status, await labelRes.clone().text()).toBe(200);
    const label = (await labelRes.json()) as { id: string };

    expect(
      (
        await json(app, "PUT", `/api/label/${label.id}`, {
          name: "service-row-denied",
          color: "#8B5CF6",
        })
      ).status,
    ).toBe(404);
    expect((await json(app, "DELETE", `/api/label/${label.id}`)).status).toBe(
      404,
    );

    // Service key without `label:manage` is refused 403 on `POST /api/label`.
    setAmbientHeaders({ "x-api-key": readOnlyServiceKey.key });
    expect(
      (
        await json(app, "POST", "/api/label", {
          workspaceId: owner.workspace.id,
          name: "service-readonly-denied",
          color: "#EC4899",
        })
      ).status,
    ).toBe(403);
  });

  /**
   * H-5 non-identity `LEGACY_PAIR_CAPABILITY` (`apps/api/src/permissions/legacy-statements.ts:29-49`)
   * mounted route inventory beyond `label`:
   *
   * 1. Deliberate `sessionOnly: true` native governance families (`requireSessionOnly()` rejects
   *    personal, MCP, and service API keys with `403 session_required` before the legacy statement gate):
   *    - `organization:update -> workspace:update`  -> `PATCH  /api/workspace/{workspaceId}`
   *      `organization:delete -> workspace:delete`  -> `DELETE /api/workspace/{workspaceId}`
   *    - `member:create -> workspace:manage_members` -> `POST   /api/workspace/{workspaceId}/members`
   *      `member:update -> workspace:manage_members` -> `PATCH  /api/workspace/{workspaceId}/members/{userId}/role`,
   *                                                     `POST   /api/workspace/{workspaceId}/roles/{roleId}/reassign`
   *      `member:delete -> member:remove`            -> `DELETE /api/workspace/{workspaceId}/members/{userId}`
   *    - `invitation:create -> member:invite`        -> `GET    /api/workspace/{workspaceId}/invitation-roles`,
   *                                                     `POST   /api/workspace/{workspaceId}/invitations`
   *      `invitation:cancel -> member:invite`        -> `DELETE /api/invitation/{id}` (`GET /api/invitation/{id}` deprecated 403)
   *    - `ac:read -> workspace:read`                 -> `GET    /api/workspace/{workspaceId}/roles` (+ `/{roleId}`, `/holders`, `/history`, `POST /preview`)
   *      `ac:create|update|delete -> workspace:manage_roles` -> `POST`/`PATCH`/`DELETE /api/workspace/{workspaceId}/roles*` (`elevated: true`)
   *
   * 2. Public API-key-callable canonical replacement families (Better Auth `organization()` plugin
   *    unmounted in `apps/api/src/auth.ts`; native routers enforce canonical capabilities directly):
   *    - `team:create|update|delete -> workspace:manage_settings`
   *      -> `POST /api/teams`, `PATCH /api/teams/{id}`, `DELETE /api/teams/{id}`,
   *         `POST`/`PATCH`/`DELETE /api/teams/{id}/members*` (TM-3: team-lead roster exception is session-only)
   *    - `project:share -> project:manage_members` (keyed as `"project:share"` in `LEGACY_PAIR_CAPABILITY`,
   *      not `share:create|delete`)
   *      -> `GET /api/projects/{projectId}/members/candidates`, `POST /api/projects/{projectId}/members` (`RL-3` key ceiling),
   *         `PATCH`/`DELETE /api/projects/{projectId}/members/{personId}`,
   *         `GET /api/projects/{projectId}/ownership/preview`, `PATCH /api/projects/{projectId}/ownership`;
   *         customer access routes `GET`/`PUT`/`DELETE /api/projects/{projectId}/customers*` are `sessionOnly: true`.
   */
  it("keeps organization, member, invitation, and ac mounted routes session-only against canonical and legacy API keys while preserving session controls (H-5)", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const workspaceId = owner.workspace.id;
    // Seed legacy `workspace_role` rows used by `addWorkspaceMember` / `updateWorkspaceMemberRole`
    // and `viewer` session negative controls.
    for (const [role, permission] of [
      ["member", { workspace: ["read"], project: ["read", "update"] }],
      ["viewer", { workspace: ["read"], project: ["read"] }],
    ] as const) {
      await db
        .insert(schema.workspaceRoleTable)
        .values({
          workspaceId,
          role,
          permission: JSON.stringify(permission),
          isSystem: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
    }
    const viewer = await addMember(workspaceId, "viewer");
    const candidate = await createWorkspaceMember({ role: "member" });
    await ensureAgentSession(owner.user.id);
    await ensureAgentSession(viewer.user.id);

    const { app } = createApp();

    // Seed a real pending invitation via owner session so `DELETE /api/invitation/{id}` probes a
    // live row across API keys (`403 session_required`), viewer session (`403`), and owner session (`202`).
    mockAuthenticatedSession(owner.user);
    const seededInviteRes = await json(
      app,
      "POST",
      `/api/workspace/${workspaceId}/invitations`,
      { email: "pending-invite@example.com", role: "viewer" },
    );
    expect(seededInviteRes.status, await seededInviteRes.clone().text()).toBe(
      200,
    );
    const pendingInvitation = (await seededInviteRes.json()) as { id: string };

    const canonicalGovCapabilities = [
      "workspace:read",
      "workspace:update",
      "workspace:delete",
      "workspace:manage_members",
      "member:remove",
      "member:invite",
      "workspace:manage_roles",
    ];
    const personalCanonicalKey = await mintKey(
      owner.user.id,
      canonicalGovCapabilities,
      false,
    );
    const mcpCanonicalKey = await mintKey(
      owner.user.id,
      canonicalGovCapabilities,
      true,
    );
    const serviceCanonicalKey = (
      await createServiceApiKey({ userId: owner.user.id }, workspaceId, {
        name: "gov-service-key",
        capabilities: canonicalGovCapabilities,
      })
    ).key;
    const legacyStatementKey = await makeApiKey(owner.user.id, {
      organization: ["update", "delete"],
      member: ["create", "update", "delete"],
      invitation: ["create", "cancel"],
      ac: ["create", "read", "update", "delete"],
    });

    const sessionOnlyProbes = [
      [
        "organization:update PATCH /api/workspace/{workspaceId}",
        () =>
          json(app, "PATCH", `/api/workspace/${workspaceId}`, {
            name: "Key Rename Attempt",
          }),
      ],
      [
        "organization:delete DELETE /api/workspace/{workspaceId}",
        () => json(app, "DELETE", `/api/workspace/${workspaceId}`),
      ],
      [
        "member:create POST /api/workspace/{workspaceId}/members",
        () =>
          json(app, "POST", `/api/workspace/${workspaceId}/members`, {
            userId: candidate.user.id,
            role: "viewer",
          }),
      ],
      [
        "member:update PATCH /api/workspace/{workspaceId}/members/{userId}/role",
        () =>
          json(
            app,
            "PATCH",
            `/api/workspace/${workspaceId}/members/${viewer.user.id}/role`,
            { role: "member" },
          ),
      ],
      [
        "member:delete DELETE /api/workspace/{workspaceId}/members/{userId}",
        () =>
          json(
            app,
            "DELETE",
            `/api/workspace/${workspaceId}/members/${viewer.user.id}`,
          ),
      ],
      [
        "invitation:create GET /api/workspace/{workspaceId}/invitation-roles",
        () =>
          json(app, "GET", `/api/workspace/${workspaceId}/invitation-roles`),
      ],
      [
        "invitation:create POST /api/workspace/{workspaceId}/invitations",
        () =>
          json(app, "POST", `/api/workspace/${workspaceId}/invitations`, {
            email: "key-invite@example.com",
            role: "viewer",
          }),
      ],
      [
        "invitation:cancel GET /api/invitation/{id}",
        () => json(app, "GET", `/api/invitation/${pendingInvitation.id}`),
      ],
      [
        "invitation:cancel DELETE /api/invitation/{id}",
        () => json(app, "DELETE", `/api/invitation/${pendingInvitation.id}`),
      ],
      [
        "ac:read GET /api/workspace/{workspaceId}/roles",
        () => json(app, "GET", `/api/workspace/${workspaceId}/roles`),
      ],
      [
        "ac:create POST /api/workspace/{workspaceId}/roles",
        () =>
          json(app, "POST", `/api/workspace/${workspaceId}/roles`, {
            role: "Key Role Attempt",
            capabilities: ["workspace:read"],
          }),
      ],
    ] as const;

    // 1. Every API-key credential kind (personal, MCP, service, raw legacy statements) is
    //    rejected at the `requireSessionOnly()` boundary with `403 session_required`.
    mockAnonymousSession();
    for (const [keyLabel, rawKey] of [
      ["personal canonical key", personalCanonicalKey],
      ["MCP canonical key", mcpCanonicalKey],
      ["service canonical key", serviceCanonicalKey],
      ["legacy statement key", legacyStatementKey],
    ] as const) {
      setAmbientHeaders({ "x-api-key": rawKey });
      for (const [routeLabel, call] of sessionOnlyProbes) {
        const res = await call();
        const body = await res.text();
        expect(res.status, `${keyLabel} on ${routeLabel}: ${body}`).toBe(403);
        expect(body, `${keyLabel} on ${routeLabel}`).toContain(
          "session_required",
        );
      }
    }
    setAmbientHeaders({});

    // 2. Viewer browser session passes `requireSessionOnly()` and is refused by role capability (403).
    mockAuthenticatedSession(viewer.user);
    for (const [routeLabel, call] of sessionOnlyProbes) {
      if (routeLabel.startsWith("ac:read ")) continue;
      const res = await call();
      expect(res.status, `viewer session on ${routeLabel}`).toBe(403);
    }

    // 3. Owner browser session exercises the live mounted routes without broadening any gate.
    mockAuthenticatedSession(owner.user);
    expect(
      (
        await json(app, "PATCH", `/api/workspace/${workspaceId}`, {
          name: "Session Renamed Workspace",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await json(app, "POST", `/api/workspace/${workspaceId}/members`, {
          userId: candidate.user.id,
          role: "viewer",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await json(
          app,
          "PATCH",
          `/api/workspace/${workspaceId}/members/${candidate.user.id}/role`,
          { role: "member" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await json(
          app,
          "DELETE",
          `/api/workspace/${workspaceId}/members/${candidate.user.id}`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await json(app, "GET", `/api/workspace/${workspaceId}/invitation-roles`))
        .status,
    ).toBe(200);
    // `GET /api/invitation/{id}` passes `requireWorkspacePermission({ invitation: ["cancel"] })`
    // and then hits its deliberate deprecated-disabled 403 handler.
    const getInviteDisabled = await json(
      app,
      "GET",
      `/api/invitation/${pendingInvitation.id}`,
    );
    expect(getInviteDisabled.status).toBe(403);
    await expect(getInviteDisabled.text()).resolves.toContain("deprecated");
    expect(
      (await json(app, "DELETE", `/api/invitation/${pendingInvitation.id}`))
        .status,
    ).toBe(202);
    expect(
      (await json(app, "GET", `/api/workspace/${workspaceId}/roles`)).status,
    ).toBe(200);
    // `ac:create` additionally requires step-up (`elevated: true`).
    const createRoleNoStepUp = await json(
      app,
      "POST",
      `/api/workspace/${workspaceId}/roles`,
      { role: "Triage", capabilities: ["workspace:read"] },
    );
    expect(createRoleNoStepUp.status).toBe(403);
    await expect(createRoleNoStepUp.text()).resolves.toContain("step_up");
    expect(
      (await json(app, "DELETE", `/api/workspace/${workspaceId}`)).status,
    ).toBe(202);
  });

  it("enforces canonical workspace:manage_settings on team routes and project:manage_members on project roster/ownership routes while keeping legacy team:* and project:share unilateral (H-5)", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const workspaceId = admin.workspace.id;
    const lead = await addCanonicalMember(workspaceId, "lead");
    const colleague = await addMember(workspaceId, "member");
    const outsider = await addProjectLimitedMember(workspaceId);

    const [leadPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, lead.user.id))
      .limit(1);
    const colleaguePersonId = colleague.personId;
    const leadPersonId = requireRow([leadPerson], "lead person").id;

    const { project } = await createProjectFixture({ workspaceId });
    await grantProjectRole(admin.user.id, project.id, [
      ...BUILT_IN_ROLES.admin.capabilities,
    ]);
    await grantProjectRole(lead.user.id, project.id, [
      "project:read",
      "project:update",
    ]);

    mockAnonymousSession();
    const { app } = createApp();

    // ── A. `team` family (`/api/teams*`, canonical `workspace:manage_settings`) ──
    let retainedTeamId = "";
    for (const [suffix, isMcp] of [
      ["personal", false],
      ["mcp", true],
    ] as const) {
      setAmbientHeaders({
        "x-api-key": await mintKey(
          admin.user.id,
          ["workspace:manage_settings"],
          isMcp,
        ),
      });

      const createTeamRes = await json(app, "POST", "/api/teams", {
        workspaceId,
        name: `ops-${suffix}`,
      });
      expect(createTeamRes.status, await createTeamRes.clone().text()).toBe(
        200,
      );
      const team = (await createTeamRes.json()) as { id: string };

      const patchTeamRes = await json(app, "PATCH", `/api/teams/${team.id}`, {
        name: `ops-${suffix}-renamed`,
      });
      expect(patchTeamRes.status, await patchTeamRes.clone().text()).toBe(200);

      const addMemberRes = await json(
        app,
        "POST",
        `/api/teams/${team.id}/members`,
        { personId: colleaguePersonId },
      );
      expect(addMemberRes.status, await addMemberRes.clone().text()).toBe(200);

      const updateMemberRes = await json(
        app,
        "PATCH",
        `/api/teams/${team.id}/members/${colleaguePersonId}`,
        { isLead: true },
      );
      expect(updateMemberRes.status, await updateMemberRes.clone().text()).toBe(
        200,
      );

      const removeMemberRes = await json(
        app,
        "DELETE",
        `/api/teams/${team.id}/members/${colleaguePersonId}`,
      );
      expect(removeMemberRes.status, await removeMemberRes.clone().text()).toBe(
        200,
      );

      if (suffix === "personal") {
        // Keep one live team to test `lead` team-lead roster rule and project ownership below,
        // and verify `DELETE /api/teams/{id}` (202 pending action) on the MCP-created team.
        retainedTeamId = team.id;
        await json(app, "POST", `/api/teams/${team.id}/members`, {
          personId: leadPersonId,
          isLead: true,
        });
      } else {
        const deleteTeamRes = await json(
          app,
          "DELETE",
          `/api/teams/${team.id}`,
        );
        expect(deleteTeamRes.status, await deleteTeamRes.clone().text()).toBe(
          202,
        );
      }
    }

    // Workspace service key with `workspace:manage_settings` succeeds on workspace-addressed
    // `GET /api/teams?workspaceId=...` and `POST /api/teams`, and answers 404 on row-addressed
    // `/api/teams/{id}` routes (AK-7); a read-only service key gets 403 on `POST /api/teams`.
    const teamServiceKey = await createServiceApiKey(
      { userId: admin.user.id },
      workspaceId,
      {
        name: "team-service-key",
        capabilities: [
          "workspace:read",
          "workspace:manage_settings",
          "project:manage_members",
        ],
      },
    );
    const readOnlyServiceKey = await createServiceApiKey(
      { userId: admin.user.id },
      workspaceId,
      { name: "team-readonly-service-key", capabilities: ["workspace:read"] },
    );

    setAmbientHeaders({ "x-api-key": teamServiceKey.key });
    expect(
      (await json(app, "GET", `/api/teams?workspaceId=${workspaceId}`)).status,
    ).toBe(200);
    const serviceTeamRes = await json(app, "POST", "/api/teams", {
      workspaceId,
      name: "service-created-team",
    });
    expect(serviceTeamRes.status, await serviceTeamRes.clone().text()).toBe(
      200,
    );
    const serviceTeam = (await serviceTeamRes.json()) as { id: string };
    expect(
      (
        await json(app, "PATCH", `/api/teams/${serviceTeam.id}`, {
          name: "service-row-denied",
        })
      ).status,
    ).toBe(404);
    expect(
      (await json(app, "DELETE", `/api/teams/${serviceTeam.id}`)).status,
    ).toBe(404);

    setAmbientHeaders({ "x-api-key": readOnlyServiceKey.key });
    expect(
      (
        await json(app, "POST", "/api/teams", {
          workspaceId,
          name: "service-readonly-denied",
        })
      ).status,
    ).toBe(403);

    // Team denials: `workspace:read`-only key -> 403; `lead` owner with `workspace:manage_settings`
    // key -> 403 (even on `POST /api/teams/{id}/members` where `lead` IS a designated team lead,
    // proving TM-3's team-lead exception is browser-session-only); legacy `team:*` key -> 403.
    const adminReadTeamKey = await mintKey(admin.user.id, ["workspace:read"]);
    const leadManageSettingsKey = await mintKey(lead.user.id, [
      "workspace:manage_settings",
    ]);
    const legacyTeamKey = await makeApiKey(admin.user.id, {
      team: ["create", "update", "delete"],
      workspace: ["read"],
    });

    for (const [label, key] of [
      ["workspace:read key", adminReadTeamKey],
      ["lead workspace:manage_settings key", leadManageSettingsKey],
      ["legacy team:create|update|delete key", legacyTeamKey],
    ] as const) {
      setAmbientHeaders({ "x-api-key": key });
      expect(
        (
          await json(app, "POST", "/api/teams", {
            workspaceId,
            name: `denied-${label}`,
          })
        ).status,
        `${label} POST /api/teams`,
      ).toBe(403);
      expect(
        (
          await json(app, "PATCH", `/api/teams/${retainedTeamId}`, {
            name: "denied-rename",
          })
        ).status,
        `${label} PATCH /api/teams/{id}`,
      ).toBe(403);
      expect(
        (
          await json(app, "POST", `/api/teams/${retainedTeamId}/members`, {
            personId: colleaguePersonId,
          })
        ).status,
        `${label} POST /api/teams/{id}/members`,
      ).toBe(403);
      expect(
        (await json(app, "DELETE", `/api/teams/${retainedTeamId}`)).status,
        `${label} DELETE /api/teams/{id}`,
      ).toBe(403);
    }

    // Browser session control for TM-3: the same `lead` user CAN edit their team's roster via session.
    setAmbientHeaders({});
    mockAuthenticatedSession(lead.user);
    expect(
      (
        await json(app, "POST", `/api/teams/${retainedTeamId}/members`, {
          personId: colleaguePersonId,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await json(
          app,
          "DELETE",
          `/api/teams/${retainedTeamId}/members/${colleaguePersonId}`,
        )
      ).status,
    ).toBe(200);
    mockAnonymousSession();

    // ── B. `project:share` -> `project:manage_members` family (`/api/projects/{projectId}/members*` & `/ownership*`) ──
    for (const [suffix, isMcp] of [
      ["personal", false],
      ["mcp", true],
    ] as const) {
      // 1) Strictly scoped `["project:manage_members"]` key satisfies candidates & ownership routes,
      //    while `POST /api/projects/{projectId}/members` enforces `RL-3` against the key ceiling
      //    (`403 role_exceeds_caller_authority` when the key omits `project-viewer`'s read capabilities).
      const manageMembersOnlyKey = await mintKey(
        admin.user.id,
        ["project:manage_members"],
        isMcp,
      );
      setAmbientHeaders({ "x-api-key": manageMembersOnlyKey });

      expect(
        (
          await json(
            app,
            "GET",
            `/api/projects/${project.id}/members/candidates`,
          )
        ).status,
        `${suffix} GET members/candidates`,
      ).toBe(200);
      expect(
        (
          await json(
            app,
            "GET",
            `/api/projects/${project.id}/ownership/preview?ownerTeamId=${retainedTeamId}`,
          )
        ).status,
        `${suffix} GET ownership/preview`,
      ).toBe(200);
      expect(
        (
          await json(app, "PATCH", `/api/projects/${project.id}/ownership`, {
            ownerTeamId: retainedTeamId,
          })
        ).status,
        `${suffix} PATCH ownership set`,
      ).toBe(200);
      expect(
        (
          await json(app, "PATCH", `/api/projects/${project.id}/ownership`, {
            ownerTeamId: null,
          })
        ).status,
        `${suffix} PATCH ownership clear`,
      ).toBe(200);

      const ceilingDenied = await json(
        app,
        "POST",
        `/api/projects/${project.id}/members`,
        { personId: colleaguePersonId, roleKey: "project-viewer" },
      );
      expect(ceilingDenied.status).toBe(403);
      await expect(ceilingDenied.text()).resolves.toContain(
        "role_exceeds_caller_authority",
      );

      // 2) Key carrying `project:manage_members` + `project-member` capabilities grants, updates,
      //    and revokes a direct project roster membership.
      const rosterGrantKey = await mintKey(
        admin.user.id,
        ["project:manage_members", ...BUILT_IN_ROLES.member.capabilities],
        isMcp,
      );
      setAmbientHeaders({ "x-api-key": rosterGrantKey });

      const addRosterRes = await json(
        app,
        "POST",
        `/api/projects/${project.id}/members`,
        { personId: colleaguePersonId, roleKey: "project-viewer" },
      );
      expect(addRosterRes.status, await addRosterRes.clone().text()).toBe(200);

      const patchRosterRes = await json(
        app,
        "PATCH",
        `/api/projects/${project.id}/members/${colleaguePersonId}`,
        { roleKey: "project-member" },
      );
      expect(patchRosterRes.status, await patchRosterRes.clone().text()).toBe(
        200,
      );

      const deleteRosterRes = await json(
        app,
        "DELETE",
        `/api/projects/${project.id}/members/${colleaguePersonId}`,
      );
      expect(deleteRosterRes.status, await deleteRosterRes.clone().text()).toBe(
        200,
      );

      // Customer project grant routes remain deliberately `sessionOnly: true`.
      const customerListRes = await json(
        app,
        "GET",
        `/api/projects/${project.id}/customers`,
      );
      expect(customerListRes.status).toBe(403);
      await expect(customerListRes.text()).resolves.toContain(
        "session_required",
      );
    }

    // Denials on `project:manage_members` routes:
    // - `project:update`-only or `project:manage_settings`-only key -> 403
    // - Unilateral legacy `{ project: ["read", "update", "share"] }` and `{ share: ["create", "delete"] }` -> 403
    // - `lead` owner lacking `project:manage_members` -> 403
    // - Out-of-reach owner & workspace service key -> 404
    const updateOnlyKey = await mintKey(admin.user.id, ["project:update"]);
    const settingsOnlyKey = await mintKey(admin.user.id, [
      "project:manage_settings",
    ]);
    const legacyProjectShareKey = await makeApiKey(admin.user.id, {
      project: ["read", "update", "share"],
    });
    const legacyShareResourceKey = await makeApiKey(admin.user.id, {
      project: ["read"],
      share: ["create", "delete"],
    });
    const leadManageMembersKey = await mintKey(lead.user.id, [
      "project:manage_members",
      ...BUILT_IN_ROLES.viewer.capabilities,
    ]);

    for (const [label, key] of [
      ["project:update-only", updateOnlyKey],
      ["project:manage_settings-only", settingsOnlyKey],
      ["legacy project:share", legacyProjectShareKey],
      ["legacy share:create|delete", legacyShareResourceKey],
      ["lead lacking project:manage_members", leadManageMembersKey],
    ] as const) {
      setAmbientHeaders({ "x-api-key": key });
      expect(
        (
          await json(
            app,
            "GET",
            `/api/projects/${project.id}/members/candidates`,
          )
        ).status,
        `${label} GET members/candidates`,
      ).toBe(403);
      expect(
        (
          await json(app, "POST", `/api/projects/${project.id}/members`, {
            personId: colleaguePersonId,
            roleKey: "project-viewer",
          })
        ).status,
        `${label} POST members`,
      ).toBe(403);
      expect(
        (
          await json(app, "PATCH", `/api/projects/${project.id}/ownership`, {
            ownerTeamId: null,
          })
        ).status,
        `${label} PATCH ownership`,
      ).toBe(403);
    }

    const outsiderManageMembersKey = await mintKey(outsider.user.id, [
      "project:manage_members",
      ...BUILT_IN_ROLES.viewer.capabilities,
    ]);
    for (const [label, key] of [
      ["out-of-reach personal key", outsiderManageMembersKey],
      ["workspace service key", teamServiceKey.key],
    ] as const) {
      setAmbientHeaders({ "x-api-key": key });
      expect(
        (
          await json(
            app,
            "GET",
            `/api/projects/${project.id}/members/candidates`,
          )
        ).status,
        `${label} GET members/candidates`,
      ).toBe(404);
      expect(
        (
          await json(app, "PATCH", `/api/projects/${project.id}/ownership`, {
            ownerTeamId: null,
          })
        ).status,
        `${label} PATCH ownership`,
      ).toBe(404);
    }
  });

  it("enforces live DB state in currentWorkspaceReachPredicate against a previously resolved service-principal Identity", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });

    const [ownerPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id))
      .limit(1);
    const ownerPersonId = requireRow([ownerPerson], "owner person").id;

    const serviceKey = await createServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      { name: "predicate-service-key", capabilities: ["workspace:read"] },
    );

    // Resolve `Identity` ONCE up front and retain the exact same object across every DB mutation.
    const identity = await resolveServicePrincipal({
      apiKeyId: serviceKey.id,
      workspaceId: owner.workspace.id,
      capabilities: ["workspace:read"],
    });
    expect(identity).not.toBeNull();
    if (!identity) throw new Error("Expected resolved service principal");

    const matchesWorkspaceReach = async (
      targetWorkspaceId: string,
    ): Promise<boolean> => {
      const rows = await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(
          and(
            eq(schema.workspaceTable.id, targetWorkspaceId),
            currentWorkspaceReachPredicate(identity, schema.workspaceTable.id),
          ),
        );
      return rows.length === 1;
    };

    const resetKeyState = async () => {
      await db
        .update(schema.apikeyTable)
        .set({ enabled: true, expiresAt: null })
        .where(eq(schema.apikeyTable.id, serviceKey.id));
      await db
        .update(apiKeyExtensionTable)
        .set({
          workspaceId: owner.workspace.id,
          personId: null,
          disabledAt: null,
          disabledReason: null,
        })
        .where(eq(apiKeyExtensionTable.apikeyId, serviceKey.id));
    };

    // Positive control: active, non-expired, workspace-bound service key matches its own workspace.
    expect(await matchesWorkspaceReach(owner.workspace.id)).toBe(true);

    // Table-driven single-axis invalidations retaining the SAME resolved `identity`:
    const singleAxisInvalidations: ReadonlyArray<{
      label: string;
      targetWorkspaceId: string;
      mutate: () => Promise<void>;
    }> = [
      {
        label: "1. apikey.enabled = false",
        targetWorkspaceId: owner.workspace.id,
        mutate: async () => {
          await db
            .update(schema.apikeyTable)
            .set({ enabled: false })
            .where(eq(schema.apikeyTable.id, serviceKey.id));
        },
      },
      {
        label: "2. apikey.expiresAt set in the past",
        targetWorkspaceId: owner.workspace.id,
        mutate: async () => {
          await db
            .update(schema.apikeyTable)
            .set({ expiresAt: new Date(Date.now() - 60_000) })
            .where(eq(schema.apikeyTable.id, serviceKey.id));
        },
      },
      {
        label: "3. api_key.disabledAt set",
        targetWorkspaceId: owner.workspace.id,
        mutate: async () => {
          await db
            .update(apiKeyExtensionTable)
            .set({ disabledAt: new Date(), disabledReason: "revoked_in_test" })
            .where(eq(apiKeyExtensionTable.apikeyId, serviceKey.id));
        },
      },
      {
        label: "4. api_key.personId set (person-bound)",
        targetWorkspaceId: owner.workspace.id,
        mutate: async () => {
          // `api_key_exactly_one_owner` requires `(workspace_id IS NULL) <> (person_id IS NULL)`.
          await db
            .update(apiKeyExtensionTable)
            .set({ personId: ownerPersonId, workspaceId: null })
            .where(eq(apiKeyExtensionTable.apikeyId, serviceKey.id));
        },
      },
      {
        label:
          "5a. api_key.workspaceId moved to another workspace (queried on original workspace)",
        targetWorkspaceId: owner.workspace.id,
        mutate: async () => {
          await db
            .update(apiKeyExtensionTable)
            .set({ workspaceId: other.workspace.id })
            .where(eq(apiKeyExtensionTable.apikeyId, serviceKey.id));
        },
      },
      {
        label:
          "5b. api_key.workspaceId moved to another workspace (queried on new workspace)",
        targetWorkspaceId: other.workspace.id,
        mutate: async () => {
          await db
            .update(apiKeyExtensionTable)
            .set({ workspaceId: other.workspace.id })
            .where(eq(apiKeyExtensionTable.apikeyId, serviceKey.id));
        },
      },
      {
        label:
          "7. querying currentWorkspaceReachPredicate against a different workspaceId while key is healthy",
        targetWorkspaceId: other.workspace.id,
        mutate: async () => {
          // No DB mutation: key remains healthy in `owner.workspace.id`.
        },
      },
    ];

    for (const testCase of singleAxisInvalidations) {
      await resetKeyState();
      expect(
        await matchesWorkspaceReach(owner.workspace.id),
        `baseline before ${testCase.label}`,
      ).toBe(true);
      await testCase.mutate();
      expect(
        await matchesWorkspaceReach(testCase.targetWorkspaceId),
        testCase.label,
      ).toBe(false);
    }

    // 6. `api_key` extension row deleted (and parent `apikey` row deleted):
    await resetKeyState();
    const [savedExtension] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, serviceKey.id))
      .limit(1);
    const extensionSnapshot = requireRow(
      [savedExtension],
      "extension snapshot",
    );

    await db
      .delete(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, serviceKey.id));
    expect(
      await matchesWorkspaceReach(owner.workspace.id),
      "6a. api_key extension row deleted",
    ).toBe(false);

    // Restore extension row to confirm recovery, then delete parent `apikey` row (cascades `api_key`).
    await db.insert(apiKeyExtensionTable).values(extensionSnapshot);
    expect(
      await matchesWorkspaceReach(owner.workspace.id),
      "baseline before 6b. apikey row deleted",
    ).toBe(true);

    await db
      .delete(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, serviceKey.id));
    expect(
      await matchesWorkspaceReach(owner.workspace.id),
      "6b. apikey row deleted",
    ).toBe(false);
  });
});
