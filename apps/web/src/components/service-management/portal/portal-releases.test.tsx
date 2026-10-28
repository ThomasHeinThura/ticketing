import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children?: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => <a href={to.replace("$id", params?.id ?? "")}>{children}</a>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatDateMedium: (value: string) => value,
}));
vi.mock("@/fetchers/portal/releases", () => ({
  getPortalReleases: (...args: unknown[]) => mocks.list(...args),
  getPortalRelease: (...args: unknown[]) => mocks.detail(...args),
}));

import { PortalReleaseDetail } from "./portal-release-detail";
import { PortalReleasesList } from "./portal-releases-list";

const release = {
  id: "release-2030-01",
  name: "January maintenance",
  serviceName: "Billing",
  plannedDate: "2030-01-20",
  notes: "Updated invoice exports.\nImproved payment retries.",
  publishedAt: "2030-01-22T12:00:00.000Z",
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
});

afterEach(() => {
  cleanup();
});

describe("portal release notes", () => {
  it("shows published releases and loads the next bounded page", async () => {
    mocks.list
      .mockResolvedValueOnce({ data: [release], nextCursor: "next-cursor" })
      .mockResolvedValueOnce({
        data: [
          {
            ...release,
            id: "release-2030-02",
            name: "February maintenance",
          },
        ],
        nextCursor: null,
      });
    renderWithQuery(<PortalReleasesList scope="customer-a" />);

    expect(
      await screen.findByRole("heading", {
        name: "portal:releases.title",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "January maintenance" }),
    ).toHaveAttribute("href", `/releases/${release.id}`);
    fireEvent.click(
      screen.getByRole("button", { name: "portal:releases.loadMore" }),
    );
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith({
        limit: 20,
        cursor: "next-cursor",
      }),
    );
    expect(await screen.findByText("February maintenance")).toBeTruthy();
  });

  it("renders only the frozen plaintext snapshot in release detail", async () => {
    mocks.detail.mockResolvedValue(release);
    renderWithQuery(<PortalReleaseDetail id={release.id} scope="customer-a" />);
    expect(
      await screen.findByRole("heading", { name: release.name, level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText(/Updated invoice exports\./u)).toBeTruthy();
    expect(screen.getByText(/Improved payment retries\./u)).toBeTruthy();
    expect(screen.getAllByText(/Billing/u).length).toBeGreaterThan(0);
    expect(mocks.detail).toHaveBeenCalledWith(release.id);
  });

  it("uses the same neutral unavailable message for an unpublished or foreign release", async () => {
    mocks.detail.mockRejectedValue(new HttpError(404, "Release not found"));
    renderWithQuery(<PortalReleaseDetail id={release.id} scope="customer-b" />);
    expect(await screen.findByText("portal:releases.unavailable")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
