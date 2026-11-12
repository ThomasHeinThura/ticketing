import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as localFactorService from "../../../apps/api/src/auth/local-factor-service";
import * as repository from "../../../apps/api/src/auth/repository";
import { getDatabasePool } from "../../../apps/api/src/database";
import { enforceLocalFactorEnrollment } from "../../../apps/api/src/index";

// The staff API guard keeps a session out of every protected route while first-run setup is
// unfinished. The marker travels with the factor-policy read, so the guard adds no query and a
// database failure is the same 503 as any other factor-policy failure. Unit-level; no database.
type State = Awaited<
  ReturnType<typeof localFactorService.loadLocalFactorState>
>;

function state(overrides: Partial<State> = {}): State {
  return {
    policy: { mode: "optional", requiredRoleId: null },
    required: false,
    enabled: false,
    setupCompleted: true,
    personId: "person-1",
    personSide: "staff",
    ...overrides,
  };
}

function guardContext(
  options: { portal?: string; path?: string; signedIn?: boolean } = {},
) {
  const values: Record<string, unknown> = {
    userId: "user-1",
    session:
      options.signedIn === false
        ? null
        : { id: "session-1", portal: options.portal ?? "agent" },
  };
  return {
    req: { path: options.path ?? "/api/workspaces" },
    get: (key: string) => values[key],
  } as unknown as Parameters<typeof enforceLocalFactorEnrollment>[0] & Context;
}

describe("staff API guard while first-run setup is unfinished", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup(loaded: State | Error) {
    const load = vi
      .spyOn(localFactorService, "loadLocalFactorState")
      .mockImplementation(async () => {
        if (loaded instanceof Error) throw loaded;
        return loaded;
      });
    const marker = vi.spyOn(repository, "isIncompleteBootstrapSession");
    // Anything beyond the (mocked) factor read would have to reach the database.
    const query = vi
      .spyOn(getDatabasePool(), "query")
      .mockRejectedValue(new Error("The guard must not read the database."));
    return { load, marker, query };
  }

  it("refuses the pending first administrator with mfa_enrollment_required, even with the factor policy off", async () => {
    for (const policy of [
      { mode: "off", requiredRoleId: null },
      { mode: "optional", requiredRoleId: null },
    ] as const) {
      setup(state({ setupCompleted: false, policy }));
      await expect(
        enforceLocalFactorEnrollment(guardContext()),
      ).rejects.toMatchObject({
        status: 403,
        message: "mfa_enrollment_required",
      });
      vi.restoreAllMocks();
    }
  });

  it("lets a signed-in staff user through once setup is complete and no factor is required", async () => {
    const { marker, query } = setup(state());
    await expect(
      enforceLocalFactorEnrollment(guardContext()),
    ).resolves.toBeUndefined();
    expect(marker).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("still refuses a completed instance when the policy requires a factor the user has not enrolled", async () => {
    setup(state({ required: true, enabled: false }));
    await expect(
      enforceLocalFactorEnrollment(guardContext()),
    ).rejects.toMatchObject({
      status: 403,
      message: "mfa_enrollment_required",
    });
  });

  it("answers 503 factor_policy_unavailable when the database read fails, never a bare 500", async () => {
    const { marker } = setup(new Error("connection terminated"));
    await expect(
      enforceLocalFactorEnrollment(guardContext()),
    ).rejects.toMatchObject({
      status: 503,
      message: "factor_policy_unavailable",
    });
    expect(marker).not.toHaveBeenCalled();
  });

  it("leaves the factor-status route, customer sessions and API-key calls alone", async () => {
    const { load } = setup(state({ setupCompleted: false }));
    await expect(
      enforceLocalFactorEnrollment(
        guardContext({ path: "/api/me/security/factors" }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      enforceLocalFactorEnrollment(guardContext({ portal: "customer" })),
    ).resolves.toBeUndefined();
    await expect(
      enforceLocalFactorEnrollment(guardContext({ signedIn: false })),
    ).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});
