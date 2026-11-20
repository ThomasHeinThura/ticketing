import { beforeEach, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch }));
vi.mock("../get-api-url", () => ({
  getApiUrl: (path: string) => `/api/${path}`,
}));

import { getS3Draft, saveS3Draft } from "./s3-draft";

beforeEach(() => apiFetch.mockReset());
it("retains nullable persisted IDs from both GET and PUT", async () => {
  apiFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ id: null }), { status: 200 }),
  );
  apiFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ id: "row-1" }), { status: 200 }),
  );
  expect((await getS3Draft()).id).toBeNull();
  const request = {
    version: 0,
    config: {
      connector: "external" as const,
      publicBaseUrl: "",
      region: "",
      bucket: "",
      keyPrefix: "",
      forcePathStyle: true,
      maxImageUploadBytes: 1,
      presignTtlSeconds: 1,
    },
  };
  expect((await saveS3Draft(request, "proof")).id).toBe("row-1");
  expect(apiFetch.mock.calls[1][1]).toMatchObject({
    method: "PUT",
    credentials: "include",
    cache: "no-store",
  });
});
