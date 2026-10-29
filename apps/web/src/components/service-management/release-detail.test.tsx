import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseDetail } from "@/fetchers/service-management";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({ update: vi.fn(), canManage: true }));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key.includes(":") ? key : `${namespace}:${key}`, options),
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-one" } }),
}));
vi.mock("@/hooks/queries/service-management", () => ({
  useCatalogueStatus: () => ({ data: { canManageReleases: mocks.canManage } }),
  useRelease: () => ({ data: release, isLoading: false, isError: false }),
  useInvalidateServiceManagement: () => vi.fn(),
}));
vi.mock("@/fetchers/service-management", () => ({
  RELEASE_STATUSES: ["planned", "in_progress", "released", "cancelled"],
  updateRelease: (...args: unknown[]) => mocks.update(...args),
  setReleaseNotes: vi.fn(),
  toggleReleaseChecklistItem: vi.fn(),
  createRelease: vi.fn(),
}));

import { ReleaseDetailView } from "./release-detail";

const release: ReleaseDetail = {
  id: "release-one",
  workspaceId: "workspace-one",
  name: "October release",
  serviceId: "service-one",
  serviceName: "Payments",
  plannedDate: "2026-10-31",
  status: "planned",
  publishToPortal: false,
  publishedAt: null,
  version: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  notes: null,
  notesGeneratedAt: null,
  notesEditedAt: null,
  notesLocked: false,
  changes: [],
  hiddenChangeCount: 0,
  checklist: [],
};

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReleaseDetailView releaseId={release.id} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.canManage = true;
  mocks.update.mockResolvedValue(release);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("release detail calendar", () => {
  it("keeps date-only and versioned update semantics when clearing the optional date", async () => {
    setup();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Planned date" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByRole("button", { name: "Planned date" }),
    ).toHaveTextContent("Not set");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith("release-one", {
        name: "October release",
        plannedDate: null,
        status: "planned",
        publishToPortal: false,
        changeKeys: [],
        version: 3,
      }),
    );
  });

  it("keeps the planned-date picker disabled without release-management permission", () => {
    mocks.canManage = false;
    setup();
    expect(screen.getByRole("button", { name: "Planned date" })).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
