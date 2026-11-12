import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  pathname: "/announcements",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children?: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={to.replace("$id", params?.id ?? "")} {...props}>
      {children}
    </a>
  ),
  useLocation: (options?: {
    select?: (value: { pathname: string }) => unknown;
  }) => {
    const location = { pathname: mocks.pathname };
    return options?.select ? options.select(location) : location;
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => value,
}));
vi.mock("@/fetchers/portal/announcements", () => ({
  getPortalAnnouncements: (...args: unknown[]) => mocks.list(...args),
  getPortalAnnouncement: (...args: unknown[]) => mocks.detail(...args),
}));

import { PortalAnnouncementDetail } from "./portal-announcement-detail";
import { PortalAnnouncementsList } from "./portal-announcements-list";

const announcement = {
  id: "announcement-one",
  title: "Planned maintenance",
  body: "Line one.\nLine two.",
  severity: "maintenance" as const,
  startsAt: "2030-01-20T08:00:00.000Z",
  endsAt: "2030-01-20T09:00:00.000Z",
  publishedAt: "2030-01-19T08:00:00.000Z",
};

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.detail.mockReset();
  mocks.pathname = "/announcements";
});
afterEach(() => cleanup());

describe("portal announcements", () => {
  it("lists announcements with severity and a link to each, beside the release notes tab", async () => {
    mocks.list.mockResolvedValue({ data: [announcement], nextCursor: null });
    renderWithQuery(<PortalAnnouncementsList scope="user-one" />);
    expect(
      await screen.findByRole("link", { name: "Planned maintenance" }),
    ).toHaveAttribute("href", "/announcements/announcement-one");
    expect(
      screen.getByText("portal:announcements.severity.maintenance"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "portal:announcements.tabs.releaseNotes",
      }),
    ).toHaveAttribute("href", "/releases");
    expect(
      screen.getByRole("link", {
        name: "portal:announcements.tabs.announcements",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(mocks.list).toHaveBeenCalledWith({ limit: 20, cursor: undefined });
  });

  it("shows the empty state", async () => {
    mocks.list.mockResolvedValue({ data: [], nextCursor: null });
    renderWithQuery(<PortalAnnouncementsList scope="user-one" />);
    const title = await screen.findByText("portal:announcements.emptyTitle");
    expect(title).toBeInTheDocument();
    // UX-1a (CP-10): the shared empty look, with a decorative icon.
    expect(
      title
        .closest("[data-slot=empty]")
        ?.querySelector("[data-slot=empty-media][aria-hidden=true] svg"),
    ).not.toBeNull();
  });

  it("renders the body as plain text", async () => {
    mocks.detail.mockResolvedValue({
      ...announcement,
      body: "<b>not bold</b>",
    });
    renderWithQuery(
      <PortalAnnouncementDetail id="announcement-one" scope="user-one" />,
    );
    expect(await screen.findByText("<b>not bold</b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("says an unreachable announcement is unavailable", async () => {
    mocks.detail.mockRejectedValue(new HttpError(404, "Not found"));
    renderWithQuery(
      <PortalAnnouncementDetail id="announcement-x" scope="user-one" />,
    );
    expect(
      await screen.findByText("portal:announcements.unavailable"),
    ).toBeInTheDocument();
  });
});
