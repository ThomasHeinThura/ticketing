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
import type { Announcement } from "@/fetchers/announcements";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  remove: vi.fn(),
  openPendingAction: vi.fn(),
  canManage: true,
  catalogueEnabled: true,
  announcementsEnabled: vi.fn(),
  canAddressWorkspace: true,
  rows: [] as Announcement[],
}));
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
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/hooks/queries/service-management", () => ({
  useCatalogueStatus: () => ({
    data: {
      enabled: mocks.catalogueEnabled,
      canManageServices: mocks.canManage,
    },
    isLoading: false,
  }),
  useInvalidateServiceManagement: () => vi.fn(),
  isFeatureDisabled: () => false,
}));
vi.mock("@/hooks/queries/announcements", () => ({
  useAnnouncements: (_workspaceId: string, enabled: boolean) => {
    mocks.announcementsEnabled(enabled);
    return {
      data: mocks.rows,
      isLoading: false,
      isError: false,
    };
  },
  useAnnouncementAudienceOptions: () => ({
    data: {
      canAddressWorkspace: mocks.canAddressWorkspace,
      organisations: [
        { id: "org-contoso", name: "Contoso" },
        { id: "org-fabrikam", name: "Fabrikam" },
      ],
      projects: [
        {
          id: "project-portal",
          name: "Customer portal",
          organisationId: "org-contoso",
          organisationName: "Contoso",
        },
      ],
    },
  }),
}));
vi.mock("@/fetchers/announcements", async () => ({
  ...(await vi.importActual<typeof import("@/fetchers/announcements")>(
    "@/fetchers/announcements",
  )),
  createAnnouncement: (...args: unknown[]) => mocks.create(...args),
  updateAnnouncement: (...args: unknown[]) => mocks.update(...args),
  setAnnouncementPublished: (...args: unknown[]) => mocks.publish(...args),
  requestAnnouncementDeletion: (...args: unknown[]) => mocks.remove(...args),
}));

import { AnnouncementsList } from "./announcements-list";

const draft: Announcement = {
  id: "announcement-one",
  workspaceId: "workspace-one",
  title: "Database maintenance",
  body: "Read-only for one hour.",
  severity: "maintenance",
  audience: "organisations",
  organisations: [{ id: "org-contoso", name: "Contoso" }],
  projects: [],
  startsAt: "2026-11-02T08:00:00.000Z",
  endsAt: "2026-11-02T09:00:00.000Z",
  publishedAt: null,
  version: 3,
  createdAt: "2026-10-30T08:00:00.000Z",
  updatedAt: "2026-10-30T08:00:00.000Z",
  reachesAudience: true,
};

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnnouncementsList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canManage = true;
  mocks.catalogueEnabled = true;
  mocks.canAddressWorkspace = true;
  mocks.rows = [draft];
  mocks.create.mockResolvedValue(draft);
  mocks.publish.mockResolvedValue({ ...draft, publishedAt: draft.startsAt });
  mocks.remove.mockResolvedValue({ pendingActionId: "pending-one" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("announcements management", () => {
  it("lists announcements with severity, state, audience and window", () => {
    setup();
    expect(screen.getByText("Database maintenance")).toBeInTheDocument();
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/Contoso/)).toBeInTheDocument();
  });

  it("publishes with the row version and requests deletion through a pending action", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(mocks.publish).toHaveBeenCalledWith("announcement-one", 3, true),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Database maintenance" }),
    );
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pending-one",
      }),
    );
  });

  it("creates a draft addressed to chosen organisations", async () => {
    mocks.rows = [];
    setup();
    fireEvent.click(screen.getByRole("button", { name: "New announcement" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "Incident: payments" },
    });
    fireEvent.change(within(dialog).getByLabelText("Message"), {
      target: { value: "We are investigating." },
    });
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        "workspace-one",
        expect.objectContaining({
          title: "Incident: payments",
          body: "We are investigating.",
          severity: "info",
          audience: "workspace",
          organisationIds: [],
          projectIds: [],
          endsAt: null,
        }),
      ),
    );
  });

  it("keeps a manager without reach to every customer project from addressing all customers", async () => {
    mocks.canAddressWorkspace = false;
    mocks.rows = [
      {
        ...draft,
        id: "announcement-all",
        audience: "workspace",
        reachesAudience: false,
      },
    ];
    setup();
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "New announcement" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Addressing all customers needs access to every customer project in this workspace.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "Contoso maintenance" },
    });
    // The audience starts at specific organisations, so saving waits for one to be chosen.
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Contoso" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        "workspace-one",
        expect.objectContaining({
          audience: "organisations",
          organisationIds: ["org-contoso"],
        }),
      ),
    );
  });

  it("locks a published notice that reaches customers outside the caller's reach", async () => {
    const reason =
      "This announcement is published to customers outside your access. Only someone with access to every customer it addresses can edit, unpublish or delete it.";
    mocks.rows = [
      {
        ...draft,
        publishedAt: draft.startsAt,
        reachesAudience: false,
      },
    ];
    setup();
    const unpublish = screen.getByRole("button", { name: "Unpublish" });
    const edit = screen.getByRole("button", {
      name: "Edit Database maintenance",
    });
    const remove = screen.getByRole("button", {
      name: "Delete Database maintenance",
    });
    for (const control of [unpublish, edit, remove])
      expect(control).toBeDisabled();
    // The reason is on the card, describes each locked control and shows in its tooltip.
    for (const control of [unpublish, edit, remove])
      expect(control).toHaveAccessibleDescription(reason);
    const trigger = edit.parentElement;
    if (!trigger) throw new Error("the locked control has no tooltip trigger");
    expect(trigger).toHaveAttribute("data-slot", "tooltip-trigger");
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    await waitFor(() => expect(screen.getAllByText(reason)).toHaveLength(2), {
      timeout: 2000,
    });
    fireEvent.click(edit);
    fireEvent.click(remove);
    fireEvent.click(unpublish);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("keeps a draft with targets outside the caller's reach editable but unpublishable", () => {
    mocks.rows = [{ ...draft, reachesAudience: false }];
    setup();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(
      screen.getByText(
        "Publishing this announcement needs access to every customer it addresses.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Database maintenance" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Delete Database maintenance" }),
    ).toBeEnabled();
  });

  it("keeps a published notice the caller fully reaches changeable", () => {
    mocks.rows = [{ ...draft, publishedAt: draft.startsAt }];
    setup();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Edit Database maintenance" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Delete Database maintenance" }),
    ).toBeEnabled();
  });

  it("moves the card actions under the text on phones so the title keeps the full width", () => {
    mocks.rows = [
      { ...draft, publishedAt: draft.startsAt, reachesAudience: false },
    ];
    setup();
    const edit = screen.getByRole("button", {
      name: "Edit Database maintenance",
    });
    const actions = edit.closest('[data-slot="card-action"]');
    if (!actions) throw new Error("the card actions are not in a CardAction");
    // Mobile: own row below title and description, left aligned in the text column.
    for (const name of [
      "col-start-1",
      "row-start-3",
      "row-span-1",
      "justify-self-start",
      "flex-wrap",
    ])
      expect(actions).toHaveClass(name);
    // One column on phones, so title and description are not squeezed beside an empty track.
    const header = actions.closest('[data-slot="card-header"]');
    expect(header).toHaveClass("has-data-[slot=card-action]:grid-cols-1");
    expect(header).toHaveClass(
      "sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]",
    );
    // A long title wraps on phones instead of being cut off; it truncates from `sm` up.
    const title = screen.getByText("Database maintenance");
    expect(title).toHaveClass("break-words", "sm:truncate");
    expect(title).not.toHaveClass("truncate");
    // From `sm` up: the original column beside the title (desktop G8 baseline unchanged).
    for (const name of [
      "sm:col-start-2",
      "sm:row-start-1",
      "sm:row-span-2",
      "sm:justify-self-end",
    ])
      expect(actions).toHaveClass(name);
  });

  it("shows an explanation instead of controls without service management permission", () => {
    mocks.canManage = false;
    setup();
    expect(
      screen.queryByRole("button", { name: "New announcement" }),
    ).toBeNull();
    expect(
      screen.getByText("You cannot manage announcements"),
    ).toBeInTheDocument();
  });
});

describe("announcements with the catalogue off (UAT re-audit)", () => {
  it("shows the off state once, offers no New announcement and asks for no list", () => {
    mocks.catalogueEnabled = false;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AnnouncementsList />
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId("service-catalogue-off")).toHaveLength(1);
    expect(
      screen.queryByRole("button", {
        name: translate("serviceManagement:announcements.list.new"),
      }),
    ).toBeNull();
    expect(mocks.announcementsEnabled).toHaveBeenCalled();
    for (const [enabled] of mocks.announcementsEnabled.mock.calls)
      expect(enabled).toBe(false);
  });
});
