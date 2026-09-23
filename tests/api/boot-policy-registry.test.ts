import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Boot-failure proof for issue #8 Slice 0.
 *
 * `apps/api/src/index.ts` now imports `policyRegistry` from `./policy-registry` at module
 * scope (and reads it in `runStartupTasks()`), and `policy-registry.ts` builds the registry
 * with `createPolicyRegistry(POLICY_SOURCES)` at module load. An invalid entry in any
 * `policy.ts` feeding that merged registry must therefore make constructing the *production
 * entry module* throw `PolicyRegistryError`, before any code can reach `startServer()` /
 * `serve()` -- i.e. before the app could ever listen. Per ADR 0010 SS1 and issue #8's
 * "done when" list: "an invalid registry fails at boot / module initialisation."
 *
 * This deliberately imports `apps/api/src/index.ts` itself (dynamically, after
 * `vi.resetModules()`), not the test-only `tests/permissions/api-app.ts` helper -- proving
 * the *production* module graph fails at boot, not merely a test harness that happens to
 * import the registry on its own. A mutation check (remove the `policy-registry` import from
 * `index.ts`) must make this test fail; see the PR description for that result.
 *
 * The assertion checks `error.constructor.name` and message content rather than `instanceof
 * PolicyRegistryError`: `apps/api`'s own module graph resolves `@taskdesk/permissions` to the
 * package's *built* `dist` output (its `package.json` `main`/`exports`), so a class imported
 * here from `packages/permissions/src` would be a different class object across that module
 * boundary and `instanceof` would spuriously fail even on a passing case.
 */
describe("production boot: invalid policy registry", () => {
  afterEach(() => {
    vi.doUnmock("../../apps/api/src/work-item/policy");
    vi.resetModules();
  });

  it("rejects with PolicyRegistryError before the app can listen, for a capability policy missing scopeSource", async () => {
    vi.doMock("../../apps/api/src/work-item/policy", () => ({
      workItemPolicies: {
        "POST /api/projects/{projectId}/work-items": {
          capability: "work_item:create",
          scope: "project",
          // scopeSource intentionally omitted: packages/permissions/src/registry.ts's
          // validatePolicy() requires it on every capability policy, with no default.
          reach: "required",
        },
      },
    }));
    vi.resetModules();

    let caught: unknown;
    try {
      await import("../../apps/api/src/index");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).constructor.name).toBe("PolicyRegistryError");
    expect((caught as Error).message).toContain("scopeSource");
  });

  it("rejects with PolicyRegistryError before the app can listen, for a duplicate route key across two policy sources", async () => {
    vi.doMock("../../apps/api/src/work-item/policy", () => ({
      workItemPolicies: {
        // Collides with platformPolicies's own "GET /api/health" entry in
        // apps/api/src/policy-registry.ts -- createPolicyRegistry refuses a route key
        // declared by more than one policy source.
        "GET /api/health": {
          capability: "work_item:read",
          scope: "project",
          scopeSource: "row",
        },
      },
    }));
    vi.resetModules();

    let caught: unknown;
    try {
      await import("../../apps/api/src/index");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).constructor.name).toBe("PolicyRegistryError");
    expect((caught as Error).message).toContain("declared twice");
  });
});
