import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import type { IdentityConnectionEventPage } from "@/fetchers/god-mode/identity-connections";
import { renderWithQuery } from "@/test/identity-test-harness";
import { IdentityConnectionEvents } from "./identity-connection-events";

const mocks = vi.hoisted(() => ({ events: vi.fn() }));

vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(`${namespace}:${key}`, options),
      i18n: { language: "en-US" },
    }),
  };
});
vi.mock("@/fetchers/god-mode/identity-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/identity-connections")
  >()),
  getIdentityConnectionEvents: (...args: unknown[]) => mocks.events(...args),
}));

const page = (
  data: IdentityConnectionEventPage["data"],
  nextCursor: string | null = null,
): IdentityConnectionEventPage => ({
  data,
  page: { nextCursor, hasMore: nextCursor !== null },
});

beforeEach(() => {
  mocks.events.mockResolvedValue(
    page(
      [
        {
          kind: "token.rotated",
          outcome: "succeeded",
          actorType: "person",
          createdAt: "2026-10-15T10:30:00.000Z",
        },
        {
          kind: "request.denied",
          outcome: "denied",
          actorType: "scim",
          createdAt: "2026-10-15T09:00:00.000Z",
        },
      ],
      "cursor_a-1",
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdentityConnectionEvents", () => {
  it("renders safe summaries and pages through the URL-backed cursor", async () => {
    const onCursorChange = vi.fn();
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor={undefined}
        onCursorChange={onCursorChange}
      />,
    );
    expect(await screen.findByText("Token rotated")).toBeInTheDocument();
    expect(screen.getByText(/Denied · SCIM/u)).toBeInTheDocument();
    expect(mocks.events).toHaveBeenCalledWith("conn-1", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Older events" }));
    expect(onCursorChange).toHaveBeenCalledWith("cursor_a-1");
    expect(screen.queryByRole("button", { name: "Newest events" })).toBeNull();
  });

  it("offers a way back to the newest events when a cursor is open", async () => {
    const onCursorChange = vi.fn();
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor="cursor_a-1"
        onCursorChange={onCursorChange}
      />,
    );
    await screen.findByText("Token rotated");
    expect(mocks.events).toHaveBeenCalledWith("conn-1", "cursor_a-1");
    fireEvent.click(screen.getByRole("button", { name: "Newest events" }));
    expect(onCursorChange).toHaveBeenCalledWith(undefined);
  });

  it("shows an explicit empty state", async () => {
    mocks.events.mockResolvedValue(page([]));
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor={undefined}
        onCursorChange={vi.fn()}
      />,
    );
    expect(await screen.findByText("No events")).toBeInTheDocument();
  });

  it("shows a loading state before data", () => {
    mocks.events.mockReturnValue(new Promise(() => {}));
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor={undefined}
        onCursorChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("status", { name: "Loading provisioning history" }),
    ).toBeInTheDocument();
  });

  it("explains denied access, a missing connection and a plain failure, each with retry where useful", async () => {
    mocks.events.mockRejectedValue(
      new IdentityAdminError(403, "x", "Forbidden", null),
    );
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor={undefined}
        onCursorChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(/instance administrator access/u),
    ).toBeInTheDocument();
    cleanup();
    mocks.events.mockRejectedValue(
      new IdentityAdminError(404, "x", "Connection unavailable", null),
    );
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor={undefined}
        onCursorChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("This connection is no longer available."),
    ).toBeInTheDocument();
    cleanup();
    mocks.events.mockRejectedValue(
      new IdentityAdminError(400, "x", "Invalid cursor or limit", null),
    );
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor="bad"
        onCursorChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(/Event history could not be loaded/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("labels an unknown event or outcome without echoing server text", async () => {
    mocks.events.mockResolvedValue(
      page([
        {
          kind: "future.kind" as never,
          outcome: "weird <b>x</b>",
          actorType: "oidc",
          createdAt: "2026-10-15T10:30:00.000Z",
        },
      ]),
    );
    renderWithQuery(
      <IdentityConnectionEvents
        connectionId="conn-1"
        cursor={undefined}
        onCursorChange={vi.fn()}
      />,
    );
    await screen.findByText("Unknown", { selector: "p.font-medium" });
    expect(document.body.textContent).not.toContain("weird");
    expect(document.body.textContent).not.toContain("future.kind");
  });
});
