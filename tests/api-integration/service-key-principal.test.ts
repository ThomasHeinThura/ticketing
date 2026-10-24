/**
 * AK-7: a workspace service key has no person behind it, so it used to arrive with an empty
 * user id and every policy check denied it. It now resolves to a principal scoped to its own
 * workspace and its own stored capability subset (`permissions/service-principal.ts`).
 * Driven through the real key creation, verification and request-identity code on a database.
 */
import { can } from "@taskdesk/permissions";
import { beforeEach, describe, expect, it } from "vitest";
import { assertKeyHasApprover } from "../../apps/api/src/api-key/credential";
import { loadApiKeyKind } from "../../apps/api/src/api-key/repository";
import { createServiceApiKey } from "../../apps/api/src/api-key/service";
import { createApp } from "../../apps/api/src/index";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { verifyApiKey } from "../../apps/api/src/utils/verify-api-key";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function serviceKey(capabilities: string[]) {
  const owner = await createWorkspaceMember({ role: "owner" });
  const created = await createServiceApiKey(
    { userId: owner.user.id },
    owner.workspace.id,
    { name: "ci-bot", capabilities },
  );
  const verified = await verifyApiKey(created.key);
  if (!verified?.valid || !verified.key) throw new Error("key did not verify");
  const kind = await loadApiKeyKind(verified.key.id);
  return { owner, created, verified: verified.key, kind };
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("workspace service key principal", () => {
  it("loads the key's workspace and frozen subset, and is never an MCP key", async () => {
    const { owner, verified, kind } = await serviceKey([
      "work_item:read",
      "work_item:update",
    ]);
    expect(verified.kind).toBe("service");
    expect(kind).toMatchObject({
      kind: "service",
      isMcp: false,
      workspaceId: owner.workspace.id,
      personId: null,
    });
    expect([...(kind.capabilities ?? [])].sort()).toEqual([
      "work_item:read",
      "work_item:update",
    ]);
  });

  it("resolves a principal with exactly the stored subset in its own workspace and nothing elsewhere", async () => {
    const { owner, verified, kind } = await serviceKey([
      "work_item:read",
      "work_item:update",
    ]);
    const identity = await resolveRequestIdentity({
      userId: verified.userId,
      apiKey: {
        id: verified.id,
        userId: verified.userId,
        enabled: true,
        permissions: verified.permissions,
        isMcp: false,
        service: {
          workspaceId: owner.workspace.id,
          capabilities: kind.capabilities,
        },
      },
    });
    expect(identity).not.toBeNull();
    if (!identity) return;
    expect(identity.credential).toBe("api_key");
    expect(identity.side).toBe("staff");
    // Never an instance principal, never project reach.
    expect(
      identity.authority.every((grant) => grant.scope === "workspace"),
    ).toBe(true);
    expect(identity.reach).toEqual({ kind: "membership" });
    expect(identity.personId.startsWith("service-key:")).toBe(true);

    const here = {
      workspaceId: owner.workspace.id,
      projectId: "p-1",
      workItemProjectId: "p-1",
      ancestorProjectIds: [],
    };
    expect(can(identity, "work_item:update", "work_item", here)).toBe(true);
    expect(can(identity, "work_item:delete", "work_item", here)).toBe(false);
    expect(
      can(identity, "work_item:update", "work_item", {
        ...here,
        workspaceId: "another-workspace",
      }),
    ).toBe(false);
  });

  it("holds nothing once its workspace is gone (fail closed)", async () => {
    const { verified } = await serviceKey(["work_item:read"]);
    const identity = await resolveRequestIdentity({
      userId: verified.userId,
      apiKey: {
        id: verified.id,
        userId: verified.userId,
        enabled: true,
        permissions: verified.permissions,
        service: {
          workspaceId: "no-such-workspace",
          capabilities: ["work_item:read"],
        },
      },
    });
    expect(identity).toBeNull();
  });

  it("still cannot approve a deletion: it has no person, so no_approver", async () => {
    const { kind } = await serviceKey(["work_item:read"]);
    expect(() => assertKeyHasApprover(kind)).toThrow(/no_approver/);
  });

  it("is still refused on routes that belong to a person (`/api/me/*`)", async () => {
    const { created } = await serviceKey(["work_item:read"]);
    const { app } = createApp();
    const response = await app.request("/api/me/api-keys", {
      headers: { "x-api-key": created.key },
    });
    // A personal-key route needs a person; the key is refused, never treated as one. Workspace
    // routes are covered by `p4-closeout-service-key-http.test.ts`.
    expect([401, 403]).toContain(response.status);
  });
});
