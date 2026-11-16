import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalCanonicalPreference } from "@/fetchers/notification-preferences/portal-canonical-preference";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  handoff: vi.fn(),
  getQuiet: vi.fn(),
  saveQuiet: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "@/fetchers/notification-preferences/portal-canonical-preference",
  () => ({
    getPortalCanonicalPreferences: mocks.get,
    savePortalCanonicalPreference: mocks.save,
    getPortalEmailLinkHandoff: mocks.handoff,
    getPortalQuietHours: mocks.getQuiet,
    savePortalQuietHours: mocks.saveQuiet,
  }),
);

import { PortalCanonicalPreferencesPage } from "./portal-canonical-preferences";

const kinds = [
  "work_item.mentioned",
  "work_item.commented",
  "work_item.transitioned",
  "submission.replied",
  "submission.declined",
  "submission.accepted",
  "approval.requested",
  "approval.expiring",
  "approval.withdrawn",
] as const;
function rows(): PortalCanonicalPreference[] {
  return kinds.map((eventKind) => ({
    eventKind,
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled:
      eventKind === "work_item.mentioned" || eventKind.startsWith("approval."),
    digest: "off",
    source: "default",
  }));
}
function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <PortalCanonicalPreferencesPage portalUserId="customer-1" />
    </QueryClientProvider>,
  );
}
function card(eventKind: string) {
  const node = document.querySelector(`[data-event-kind="${eventKind}"]`);
  if (!(node instanceof HTMLElement)) throw new Error("Event card missing");
  return within(node);
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(rows());
  mocks.handoff.mockResolvedValue(null);
  mocks.getQuiet.mockResolvedValue(null);
  mocks.save.mockImplementation(
    async (value: { eventKind: string; enabled: boolean; digest: string }) => {
      const result = rows().map((row) =>
        row.eventKind === value.eventKind
          ? { ...row, ...value, source: "global" }
          : row,
      );
      mocks.get.mockResolvedValue(result);
      return result;
    },
  );
  mocks.saveQuiet.mockImplementation(async (value: unknown) => {
    mocks.getQuiet.mockResolvedValue(value);
    return value;
  });
});

describe("portal notification preferences", () => {
  it("focuses the signed event after a retained loading placeholder clears", async () => {
    let resolvePreferences: (value: PortalCanonicalPreference[]) => void =
      () => {};
    mocks.get.mockReturnValue(
      new Promise<PortalCanonicalPreference[]>((resolve) => {
        resolvePreferences = resolve;
      }),
    );
    mocks.handoff.mockResolvedValue({
      eventKind: "approval.expiring",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
    });
    renderPage();
    await screen.findByRole("status", { name: "common:empty.loading" });
    resolvePreferences(rows());
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "data-event-kind",
        "approval.expiring",
      ),
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(kinds)(
    "focuses the matching verified %s email card without saving",
    async (eventKind) => {
      mocks.handoff.mockResolvedValue({
        eventKind,
        channel: "notify.email",
        scope: "global",
        scopeId: null,
      });
      renderPage();
      await screen.findByText("portal:account.notifications.mention.title");
      await waitFor(() =>
        expect(document.activeElement).toHaveAttribute(
          "data-event-kind",
          eventKind,
        ),
      );
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.saveQuiet).not.toHaveBeenCalled();
    },
  );

  it("shows nine email controls, keeps in-app delivery on and offers no urgent digest", async () => {
    renderPage();
    await screen.findByText("portal:account.notifications.mention.title");
    expect(screen.getAllByRole("switch")).toHaveLength(9);
    expect(
      screen.getByText("portal:account.notifications.inAppAlways"),
    ).toBeVisible();
    expect(card("work_item.mentioned").queryByRole("combobox")).toBeNull();
    expect(card("approval.expiring").queryByRole("combobox")).toBeNull();
    for (const kind of kinds.filter(
      (value) =>
        value !== "work_item.mentioned" && value !== "approval.expiring",
    ))
      expect(card(kind).getByRole("combobox")).toBeVisible();
  });

  it("saves an explicit event and announces one success", async () => {
    renderPage();
    await screen.findByText(
      "portal:account.notifications.requestAccepted.title",
    );
    const accepted = card("submission.accepted");
    fireEvent.click(accepted.getByRole("switch"));
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(
      accepted.getByRole("button", {
        name: "portal:account.notifications.save",
      }),
    );
    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledTimes(1);
      expect(mocks.save.mock.calls[0]?.[0]).toEqual({
        eventKind: "submission.accepted",
        enabled: true,
        digest: "off",
      });
    });
    await waitFor(() => {
      const announcements = accepted
        .getAllByRole("status")
        .filter((node) => node.textContent?.trim());
      expect(announcements).toHaveLength(1);
      expect(announcements[0]).toHaveTextContent(
        "portal:account.notifications.saved",
      );
    });
    expect(
      screen.getAllByRole("status").filter((node) => node.textContent?.trim()),
    ).toHaveLength(1);
  });

  it("retains the draft on save failure and retries without exposing server text", async () => {
    mocks.save.mockRejectedValueOnce(new Error("private server detail"));
    renderPage();
    await screen.findByText("portal:account.notifications.transition.title");
    const transition = card("work_item.transitioned");
    fireEvent.click(transition.getByRole("switch"));
    fireEvent.click(
      transition.getByRole("button", {
        name: "portal:account.notifications.save",
      }),
    );
    expect(await transition.findByRole("alert")).toHaveTextContent(
      "portal:account.notifications.saveFailed",
    );
    expect(screen.queryByText("private server detail")).toBeNull();
    expect(transition.getByRole("switch")).toBeChecked();
    fireEvent.click(
      transition.getByRole("button", {
        name: "portal:account.notifications.save",
      }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(transition.queryByRole("alert")).toBeNull());
  });

  it("retries loading and renders no arbitrary handoff key", async () => {
    mocks.get.mockRejectedValueOnce(new Error("private response"));
    mocks.handoff.mockResolvedValue({
      eventKind: "secret.arbitrary",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
    });
    renderPage();
    await screen.findByText("portal:account.notifications.loadFailed");
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.tryAgain" }),
    );
    await screen.findByText("portal:account.notifications.mention.title");
    expect(
      screen.getByText("portal:account.notifications.unsupported"),
    ).toBeVisible();
    expect(screen.queryByText("secret.arbitrary")).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves and clears the customer's own quiet hours through the portal API", async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "quietHours.save" }),
    );
    await waitFor(() => {
      expect(mocks.saveQuiet).toHaveBeenCalledTimes(1);
      expect(mocks.saveQuiet.mock.calls[0]?.[0]).toEqual({
        start: "22:00",
        end: "07:00",
        timezone,
      });
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "quietHours.clear" }),
    );
    await waitFor(() => {
      expect(mocks.saveQuiet).toHaveBeenCalledTimes(2);
      expect(mocks.saveQuiet.mock.calls[1]?.[0]).toBeNull();
    });
  });

  it("retries a quiet-hours load refusal without exposing the response", async () => {
    mocks.getQuiet.mockRejectedValueOnce(
      new Error("private quiet-hour response"),
    );
    renderPage();
    await screen.findByText("notificationProvider:quietHours.unavailable");
    expect(screen.queryByText("private quiet-hour response")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.tryAgain" }),
    );
    await screen.findByRole("button", { name: "quietHours.save" });
    expect(mocks.saveQuiet).not.toHaveBeenCalled();
  });

  it("retains quiet-hour values after a save refusal and retries explicitly", async () => {
    mocks.saveQuiet.mockRejectedValueOnce(new Error("private save response"));
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "quietHours.save" }),
    );
    await screen.findByText("quietHours.saveFailed");
    expect(screen.queryByText("private save response")).toBeNull();
    expect(
      screen.getByRole("button", { name: "quietHours.start" }),
    ).toHaveTextContent("22:00");
    expect(
      screen.getByRole("button", { name: "quietHours.end" }),
    ).toHaveTextContent("07:00");
    fireEvent.click(screen.getByRole("button", { name: "quietHours.save" }));
    await waitFor(() => expect(mocks.saveQuiet).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("quietHours.saveFailed")).toBeNull(),
    );
  });
});
