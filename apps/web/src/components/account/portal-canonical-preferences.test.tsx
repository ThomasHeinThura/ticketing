import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invalidate: vi.fn(), save: vi.fn() }));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey.includes("notification-preference-handoff")
      ? {
          data: {
            eventKind: "work_item.commented",
            channel: "notify.email",
            scope: "global",
            scopeId: null,
          },
          isError: false,
          isLoading: false,
        }
      : {
          data: [
            {
              eventKind: "work_item.mentioned",
              channel: "notify.email",
              scope: "global",
              scopeId: null,
              enabled: true,
              digest: "off",
              source: "default",
            },
            {
              eventKind: "work_item.commented",
              channel: "notify.email",
              scope: "global",
              scopeId: null,
              enabled: false,
              digest: "off",
              source: "default",
            },
          ],
          isError: false,
          isLoading: false,
        },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
  }) => ({
    isPending: false,
    isError: false,
    mutate: (value: unknown, callbacks: { onSuccess: () => void }) =>
      void mutationFn(value).then(callbacks.onSuccess),
    mutateAsync: (value: unknown) => mutationFn(value),
  }),
}));
vi.mock(
  "@/fetchers/notification-preferences/portal-canonical-preference",
  () => ({
    getPortalCanonicalPreferences: vi.fn(),
    getPortalEmailLinkHandoff: vi.fn(),
    savePortalCanonicalPreference: (value: unknown) => mocks.save(value),
  }),
);

import { PortalCanonicalPreferencesPage } from "./portal-canonical-preferences";

afterEach(cleanup);
beforeEach(() => {
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.save.mockReset().mockResolvedValue([]);
});

describe("portal notification preferences", () => {
  it("focuses a verified email selector without changing saved preferences", () => {
    render(<PortalCanonicalPreferencesPage portalUserId="customer-1" />);
    expect(
      screen.getByRole("switch", {
        name: "portal:account.notifications.comment.enabled",
      }),
    ).not.toBeChecked();
    // CP-5: one card, one Save, no stray link, the delivery note once.
    expect(
      screen.getByRole("button", {
        name: "portal:account.notifications.save",
      }),
    ).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveClass("ring-ring");
    expect(
      screen.queryByRole("link", {
        name: "portal:account.notifications.requestsLink",
      }),
    ).toBeNull();
    expect(
      screen.getAllByText("portal:account.notifications.providerRequired"),
    ).toHaveLength(1);
    expect(document.querySelectorAll("[data-slot=card]")).toHaveLength(1);
  });

  it("saves every changed preference with the one Save and only those (CP-5)", async () => {
    render(<PortalCanonicalPreferencesPage portalUserId="customer-1" />);
    const save = screen.getByRole("button", {
      name: "portal:account.notifications.save",
    });
    fireEvent.click(
      screen.getByRole("switch", {
        name: "portal:account.notifications.mention.enabled",
      }),
    );
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        eventKind: "work_item.mentioned",
        enabled: false,
        digest: "off",
      }),
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("switch", {
        name: "portal:account.notifications.comment.enabled",
      }),
    );
    fireEvent.click(save);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
    expect(mocks.save).toHaveBeenCalledWith({
      eventKind: "work_item.commented",
      enabled: true,
      digest: "off",
    });
    expect(
      await screen.findByText("portal:account.notifications.saved"),
    ).toBeVisible();
  });

  it("requires an explicit save and permits a digest only for comments", async () => {
    render(<PortalCanonicalPreferencesPage portalUserId="customer-1" />);
    fireEvent.click(
      screen.getByRole("switch", {
        name: "portal:account.notifications.comment.enabled",
      }),
    );
    fireEvent.click(
      screen.getByRole("combobox", {
        name: "portal:account.notifications.comment.digest",
      }),
    );
    const daily = await screen.findByRole("option", {
      name: "portal:account.notifications.comment.digestCadence.daily",
    });
    fireEvent.pointerDown(daily);
    fireEvent.mouseDown(daily);
    fireEvent.pointerUp(daily);
    fireEvent.mouseUp(daily);
    fireEvent.click(daily);
    fireEvent.click(
      screen.getByRole("button", {
        name: "portal:account.notifications.save",
      }),
    );
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        eventKind: "work_item.commented",
        enabled: true,
        digest: "daily",
      }),
    );
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["portal", "customer-1", "canonical-notification-preferences"],
    });
  });
});
