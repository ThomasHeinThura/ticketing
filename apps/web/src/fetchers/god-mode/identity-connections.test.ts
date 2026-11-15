import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.example.test/api/${path}`,
}));

import {
  configureIdentityConnection,
  createIdentityConnection,
  createOidcGroupMapping,
  getIdentityConnections,
  getOidcGroupMappings,
  getOidcMappingOptions,
  getScimAdminSettings,
  patchScimAdmin,
  revokeScimBearer,
  rotateScimBearer,
  updateOidcGroupMapping,
} from "./identity-connections";

const TOKEN = "p".repeat(43);
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

type Init = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};
const lastCall = () => {
  const [url, init] = mocks.apiFetch.mock.calls.at(-1) as [string, Init];
  return { url, init };
};

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(async () =>
    ok({ data: [], configVersion: 1 }),
  );
});

describe("identity administration requests", () => {
  it("sends the step-up token header, method and exact body on every protected write", async () => {
    const writes: Array<[() => Promise<unknown>, string, string, unknown]> = [
      [
        () =>
          createIdentityConnection({
            body: { displayName: "x" } as never,
            token: TOKEN,
          }),
        "POST",
        "https://api.example.test/api/instance/identity-connections",
        { displayName: "x" },
      ],
      [
        () =>
          configureIdentityConnection({
            id: "conn/1",
            body: { configVersion: 3, enabled: true },
            token: TOKEN,
          }),
        "PATCH",
        "https://api.example.test/api/instance/identity-connections/conn%2F1",
        { configVersion: 3, enabled: true },
      ],
      [
        () =>
          patchScimAdmin({
            id: "conn-1",
            body: { configVersion: 3, kind: "settings", enabled: true },
            token: TOKEN,
          }),
        "PATCH",
        "https://api.example.test/api/instance/identity-connections/conn-1/scim",
        { configVersion: 3, kind: "settings", enabled: true },
      ],
      [
        () => rotateScimBearer({ id: "conn-1", version: 3, token: TOKEN }),
        "POST",
        "https://api.example.test/api/instance/identity-connections/conn-1/scim/rotate-token",
        { version: 3 },
      ],
      [
        () => revokeScimBearer({ id: "conn-1", version: 3, token: TOKEN }),
        "POST",
        "https://api.example.test/api/instance/identity-connections/conn-1/scim/revoke-token",
        { version: 3 },
      ],
    ];
    for (const [call, method, url, body] of writes) {
      mocks.apiFetch.mockImplementation(async () =>
        ok({ data: {}, configVersion: 4 }),
      );
      await call();
      const sent = lastCall();
      expect(sent.url).toBe(url);
      expect(sent.init.method).toBe(method);
      expect(sent.init.headers?.["x-taskdesk-step-up-token"]).toBe(TOKEN);
      expect(JSON.parse(sent.init.body ?? "null")).toEqual(body);
    }
  });

  it("sends no step-up header or body on reads", async () => {
    await getIdentityConnections();
    expect(lastCall().init.method).toBeUndefined();
    expect(lastCall().init.headers).toBeUndefined();
    await getScimAdminSettings("conn-1");
    expect(lastCall().init.headers).toBeUndefined();
    expect(lastCall().init.body).toBeUndefined();
  });

  it("turns a non-OK answer into a classified failure without exposing the token", async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response("step_up_unavailable", { status: 403 }),
    );
    const failure = await rotateScimBearer({
      id: "conn-1",
      version: 3,
      token: TOKEN,
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 403, kind: "step_up" });
    expect(JSON.stringify(failure)).not.toContain(TOKEN);
  });
  it("reads OIDC options and mappings using encoded connection ids", async () => {
    await getOidcMappingOptions("conn/1", "ws/1", "cursor+");
    expect(lastCall().url).toBe(
      "https://api.example.test/api/instance/identity-connections/conn%2F1/oidc-group-mappings/mapping-options?limit=100&workspaceId=ws%2F1&cursor=cursor%2B",
    );
    expect(lastCall().init.body).toBeUndefined();
    await getOidcGroupMappings("conn/1");
    expect(lastCall().url).toContain("conn%2F1/oidc-group-mappings");
  });
  it("sends exact OIDC writes and excludes proof secrets from non-OK failures", async () => {
    const body = { configVersion: 7, enabled: false };
    await updateOidcGroupMapping({
      connectionId: "conn/1",
      mappingId: "map/1",
      body,
      stepUpToken: TOKEN,
    });
    expect(lastCall().url).toContain("conn%2F1/oidc-group-mappings/map%2F1");
    expect(lastCall().init.method).toBe("PATCH");
    expect(JSON.parse(lastCall().init.body ?? "null")).toEqual(body);
    expect(lastCall().init.headers?.["x-taskdesk-step-up-token"]).toBe(TOKEN);
    const createBody = {
      configVersion: 7,
      externalGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      externalGroupNameSnapshot: null,
      scope: "organisation" as const,
      roleId: "customer",
      enabled: true,
    };
    await createOidcGroupMapping({
      connectionId: "conn/1",
      body: createBody,
      stepUpToken: TOKEN,
    });
    expect(lastCall().init.method).toBe("POST");
    expect(JSON.parse(lastCall().init.body ?? "null")).toEqual(createBody);
    mocks.apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ title: "Invalid mapping" }), {
        status: 422,
      }),
    );
    const error = await updateOidcGroupMapping({
      connectionId: "conn/1",
      mappingId: "map/1",
      body,
      stepUpToken: TOKEN,
    }).catch((e) => e);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });
});
