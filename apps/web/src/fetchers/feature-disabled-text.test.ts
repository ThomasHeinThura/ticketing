import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch }));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://agent.invalid/api${path}`,
}));

import { FeatureDisabledError, getCycles } from "./agile";
import { getPages, PagesDisabledError } from "./pages";

/** The API's feature gate answers `404` with a plain-text body, exactly as Hono sends it. */
function plainText(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=UTF-8" },
  });
}

afterEach(() => vi.clearAllMocks());

describe("feature-off answers with a plain-text body (A-11)", () => {
  it("turns the agile 404 feature_disabled into FeatureDisabledError", async () => {
    apiFetch.mockResolvedValue(plainText(404, "feature_disabled"));
    await expect(getCycles("HELP")).rejects.toBeInstanceOf(
      FeatureDisabledError,
    );
  });

  it("keeps an ordinary agile 404 a plain not-found", async () => {
    apiFetch.mockResolvedValue(plainText(404, "Project not found"));
    const error = await getCycles("HELP").catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(FeatureDisabledError);
    expect(error).toMatchObject({ status: 404 });
  });

  it("turns the pages 404 feature_disabled into PagesDisabledError", async () => {
    apiFetch.mockResolvedValue(plainText(404, "feature_disabled"));
    await expect(getPages("HELP")).rejects.toBeInstanceOf(PagesDisabledError);
    apiFetch.mockResolvedValue(plainText(404, "Project not found"));
    const error = await getPages("HELP").catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(PagesDisabledError);
    expect(error).toMatchObject({ status: 404 });
  });
});
