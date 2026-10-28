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
    expect(
      screen.getAllByRole("button", {
        name: "portal:account.notifications.save",
      })[1],
    ).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveClass("ring-ring");
    expect(
      screen.getByRole("link", {
        name: "portal:account.notifications.requestsLink",
      }),
    ).toHaveAttribute("href", "/requests");
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
      screen.getAllByRole("button", {
        name: "portal:account.notifications.save",
      })[1],
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
