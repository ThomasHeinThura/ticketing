import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import getCapabilities from "../../../apps/api/src/capabilities/controllers/get-capabilities";
import { scopeWorkCapabilitiesToProject } from "../../../apps/api/src/capabilities/project-scope";
import { capabilitiesResponseSchema } from "../../../apps/api/src/capabilities/response";

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  legacyPermission: vi.fn(),
  commentCapability: vi.fn(),
  customer: vi.fn(),
  identity: vi.fn(),
  projectCapability: vi.fn(),
  project: vi.fn(),
}));
vi.mock("../../../apps/api/src/utils/require-workspace-capability", () => ({
  assertCallerHasCapability: mocks.assertCapability,
  capabilityCredential: (key: unknown) => key,
}));
vi.mock("../../../apps/api/src/utils/require-workspace-permission", () => ({
  hasWorkspacePermission: mocks.legacyPermission,
}));
vi.mock("../../../apps/api/src/comment/has-comment-capability", () => ({
  default: mocks.commentCapability,
}));
vi.mock("../../../apps/api/src/utils/is-customer-principal", () => ({
  isCustomerPrincipal: mocks.customer,
}));
vi.mock("../../../apps/api/src/utils/has-project-reach", () => ({
  resolveCallerIdentity: mocks.identity,
  hasProjectReadCapability: mocks.projectCapability,
}));
vi.mock("../../../apps/api/src/project/hierarchy.repository", () => ({
  loadProjectAncestorIdsFor: async () => ["parent-project"],
}));
vi.mock("../../../apps/api/src/capabilities/repository", () => ({
  findCapabilityProject: mocks.project,
}));

function context(overrides: Record<string, unknown> = {}) {
  const vars: Record<string, unknown> = {
    workspaceId: "requested-workspace",
    userId: "actor",
    ...overrides,
  };
  return { get: (name: string) => vars[name] } as Context;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertCapability.mockResolvedValue(undefined);
  mocks.legacyPermission.mockResolvedValue(true);
  mocks.commentCapability.mockResolvedValue(true);
  mocks.customer.mockResolvedValue(false);
  mocks.identity.mockResolvedValue({ personId: "person" });
  mocks.project.mockResolvedValue({
    projectId: "requested-project",
    workspaceId: "requested-workspace",
  });
  mocks.projectCapability.mockReturnValue(true);
});

describe("strict attachment capability introspection", () => {
  it("checks attachment:create for the requested workspace and credential", async () => {
    const credential = { id: "credential" };
    const flags = await getCapabilities(context({ apiKey: credential }));
    expect(flags.createAttachments).toBe(true);
    expect(mocks.assertCapability).toHaveBeenCalledWith(
      "requested-workspace",
      "actor",
      "attachment:create",
      credential,
    );
  });

  it("does not derive attachment creation from broad legacy task permissions", async () => {
    mocks.assertCapability.mockImplementation(
      async (_workspace: string, _user: string, capability: string) => {
        if (capability === "attachment:create") throw new HTTPException(403);
      },
    );
    const flags = await getCapabilities(context());
    expect(flags.createTasks).toBe(true);
    expect(flags.updateTasks).toBe(true);
    expect(flags.createAttachments).toBe(false);
  });

  it("never advertises agent attachment creation to a customer principal", async () => {
    mocks.customer.mockResolvedValue(true);
    expect((await getCapabilities(context())).createAttachments).toBe(false);
  });

  it.each(["workspaceId", "userId"])(
    "denies without resolved %s",
    async (key) => {
      expect(
        (await getCapabilities(context({ [key]: undefined })))
          .createAttachments,
      ).toBe(false);
      expect(mocks.assertCapability).not.toHaveBeenCalled();
    },
  );

  it("propagates unavailable authority rather than reporting permission", async () => {
    mocks.assertCapability.mockRejectedValue(
      new Error("authority unavailable"),
    );
    await expect(getCapabilities(context())).rejects.toThrow(
      "authority unavailable",
    );
  });

  it("keeps the wire flag optional and rejects nonboolean values", async () => {
    const flags = await getCapabilities(context());
    expect(capabilitiesResponseSchema.safeParse(flags).success).toBe(true);
    const { createAttachments: _unused, ...olderFlags } = flags;
    expect(capabilitiesResponseSchema.safeParse(olderFlags).success).toBe(true);
    expect(
      capabilitiesResponseSchema.safeParse({
        ...flags,
        createAttachments: "true",
      }).success,
    ).toBe(false);
  });
});

describe("attachment capabilities in an exact project", () => {
  it("uses the requested project lookup and exact attachment capability", async () => {
    const flags = await getCapabilities(context());
    const result = await scopeWorkCapabilitiesToProject(
      context(),
      flags,
      "requested-project",
    );
    expect(result.createAttachments).toBe(true);
    expect(mocks.project).toHaveBeenCalledWith(
      { personId: "person" },
      "requested-workspace",
      "requested-project",
    );
    expect(mocks.projectCapability).toHaveBeenCalledWith(
      { personId: "person" },
      "attachment:create",
      "work_item",
      expect.objectContaining({
        projectId: "requested-project",
        workspaceId: "requested-workspace",
      }),
    );
  });

  it("intersects workspace permission with project authority", async () => {
    const flags = await getCapabilities(context());
    mocks.projectCapability.mockImplementation(
      (_identity: unknown, capability: string) =>
        capability !== "attachment:create",
    );
    const result = await scopeWorkCapabilitiesToProject(
      context(),
      flags,
      "requested-project",
    );
    expect(result.updateTasks).toBe(true);
    expect(result.createAttachments).toBe(false);
  });

  it("cannot elevate a workspace denial through a project grant", async () => {
    const flags = await getCapabilities(context());
    flags.createAttachments = false;
    expect(
      (
        await scopeWorkCapabilitiesToProject(
          context(),
          flags,
          "requested-project",
        )
      ).createAttachments,
    ).toBe(false);
  });

  it("revalidates the existing credential ceiling", async () => {
    const flags = await getCapabilities(context());
    const credential = { id: "read-only-key" };
    mocks.assertCapability.mockImplementation(
      async (_workspace: string, _user: string, capability: string) => {
        if (capability === "attachment:create") throw new HTTPException(403);
      },
    );
    const result = await scopeWorkCapabilitiesToProject(
      context({ apiKey: credential }),
      flags,
      "requested-project",
    );
    expect(result.createAttachments).toBe(false);
    expect(mocks.assertCapability).toHaveBeenCalledWith(
      "requested-workspace",
      "actor",
      "attachment:create",
      credential,
    );
  });

  it("masks an unavailable or out-of-reach project without a flag response", async () => {
    mocks.project.mockResolvedValue(null);
    const flags = await getCapabilities(context());
    await expect(
      scopeWorkCapabilitiesToProject(context(), flags, "foreign-project"),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.projectCapability).not.toHaveBeenCalled();
  });
});

describe("project capability flags follow the ancestor chain (PR-2/PR-3)", () => {
  it("evaluates every project flag with the project's ancestors, so UI flags equal the server decision", async () => {
    await scopeWorkCapabilitiesToProject(
      context(),
      { updateTasks: true } as never,
      "requested-project",
    );
    expect(mocks.projectCapability).toHaveBeenCalled();
    for (const call of mocks.projectCapability.mock.calls) {
      expect(call[3]).toMatchObject({ ancestorProjectIds: ["parent-project"] });
    }
  });
});
