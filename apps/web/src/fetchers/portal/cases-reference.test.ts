import { expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch: fetcher }));

import { getPortalHome } from "./cases";

it("retains a portal resource reference while hiding the server message", async () => {
  const id = "c".repeat(32);
  fetcher.mockResolvedValue(
    Response.json(
      { message: "private secret", requestId: id },
      { status: 503 },
    ),
  );
  const error = await getPortalHome().catch((caught: unknown) => caught);
  expect(error).toMatchObject({
    status: 503,
    requestId: id,
    message: "The request failed",
  });
});
