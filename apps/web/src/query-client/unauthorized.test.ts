import { afterEach, beforeEach, expect, it, vi } from "vitest";

const replace = vi.fn();

function stubWindow(pathname: string) {
  vi.stubGlobal("window", {
    location: { pathname, search: "", hash: "", replace },
  });
}

beforeEach(() => {
  replace.mockReset();
  vi.resetModules();
  vi.stubEnv("MODE", "agent");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("redirects once when a fetcher throws a plain Error after a 401 response", async () => {
  stubWindow("/agent/projects/ABC");
  const { default: client } = await import("./index");
  const { createApiFetch } = await import("@taskdesk/libs");
  const api = createApiFetch(
    async () => new Response("Unauthorized", { status: 401 }),
    { apiBaseUrl: "http://taskdesk.test/api", agentCsrfToken: false },
  );
  await expect(
    client.fetchQuery({
      queryKey: ["plain-401"],
      queryFn: async () => {
        const response = await api("http://taskdesk.test/api/things");
        throw new Error(await response.text());
      },
      retry: false,
    }),
  ).rejects.toThrow("Unauthorized");
  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith(
    "/auth/sign-in?redirect=%2Fagent%2Fprojects%2FABC",
  );
});

it("redirects once when a mutation is refused with a 401", async () => {
  stubWindow("/agent/dashboard");
  const { default: client } = await import("./index");
  const { HttpError } = await import("@/lib/http-error");
  await expect(
    client
      .getMutationCache()
      .build(client, {
        mutationFn: async () => {
          throw new HttpError(401, "refused");
        },
      })
      .execute(undefined),
  ).rejects.toMatchObject({ status: 401 });
  expect(replace).toHaveBeenCalledTimes(1);
});

it("does not redirect from the sign-in page itself", async () => {
  stubWindow("/auth/sign-in");
  const { default: client } = await import("./index");
  const { HttpError } = await import("@/lib/http-error");
  await expect(
    client.fetchQuery({
      queryKey: ["sign-in-401"],
      queryFn: async () => {
        throw new HttpError(401, "refused");
      },
      retry: false,
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(replace).not.toHaveBeenCalled();
});
