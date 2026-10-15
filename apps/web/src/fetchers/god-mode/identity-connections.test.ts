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
  getIdentityConnections,
  getScimAdminSettings,
  patchScimAdmin,
  revokeScimBearer,
  rotateScimBearer,
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
});
