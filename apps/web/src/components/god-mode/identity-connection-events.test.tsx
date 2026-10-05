import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityConnectionEvents } from "./identity-connection-events";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.test/${path}`,
}));

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe("identity connection event history", () => {
  it("loads the safe summary page and follows the next opaque cursor", async () => {
    apiFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                kind: "connection.changed",
                outcome: "succeeded",
                actorType: "person",
                createdAt: "2026-10-05T10:00:00.000Z",
              },
            ],
            page: { nextCursor: "cursor/older", hasMore: true },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [],
            page: { nextCursor: null, hasMore: false },
          }),
          { status: 200 },
        ),
      );
    const onCursorChange = vi.fn();
    const { rerender } = render(
      <IdentityConnectionEvents
        connectionId="connection/one"
        onCursorChange={onCursorChange}
      />,
    );

    expect(await screen.findByText("connection.changed")).toBeTruthy();
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/events?limit=25",
    );
    fireEvent.click(screen.getByRole("button", { name: "Older events" }));
    expect(onCursorChange).toHaveBeenCalledWith("cursor/older");

    rerender(
      <IdentityConnectionEvents
        connectionId="connection/one"
        cursor="cursor/older"
        onCursorChange={onCursorChange}
      />,
    );
    await screen.findByText(
      "No provisioning events have been recorded for this connection.",
    );
    expect(apiFetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.test/instance/identity-connections/connection%2Fone/events?limit=25&cursor=cursor%2Folder",
    );
  });
});
