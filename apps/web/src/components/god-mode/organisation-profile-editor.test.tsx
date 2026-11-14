import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrganisationProfile } from "@/fetchers/god-mode/organisation-lifecycle";
import { renderWithQuery } from "@/test/identity-test-harness";
import { OrganisationProfileEditor } from "./organisation-profile-editor";

const noticeState = vi.hoisted(() => ({
  hasSmtp: true as boolean | undefined,
  loading: false,
  fetching: false,
  error: false,
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({
    data:
      noticeState.hasSmtp === undefined
        ? undefined
        : { hasSmtp: noticeState.hasSmtp },
    isLoading: noticeState.loading,
    isFetching: noticeState.fetching,
    isError: noticeState.error,
  }),
}));
vi.mock("@/hooks/use-instance-admin-signal", () => ({
  useInstanceAdminSignal: () => true,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  openPendingAction: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock(
  "@/fetchers/god-mode/organisation-lifecycle",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/fetchers/god-mode/organisation-lifecycle")
    >()),
    createOrganisation: (...args: unknown[]) => mocks.create(...args),
    updateOrganisationProfile: (...args: unknown[]) => mocks.update(...args),
  }),
);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: (...args: unknown[]) => mocks.toastSuccess(...args) },
}));
vi.mock("@/fetchers/god-mode/organisations", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/organisations")
  >()),
  requestOrganisationDeletion: (...args: unknown[]) => mocks.delete(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(noticeState, {
    hasSmtp: true,
    loading: false,
    fetching: false,
    error: false,
  });
});

describe("new organisation profile defaults", () => {
  it.each([
    [false, false, false, false, true],
    [true, false, false, false, false],
    [false, true, false, false, false],
    [false, false, true, false, false],
    [false, false, false, true, false],
    [undefined, false, false, true, false],
  ])(
    "handles provider %s, loading %s, fetching %s, error %s",
    (hasSmtp, loading, fetching, error, visible) => {
      Object.assign(noticeState, { hasSmtp, loading, fetching, error });
      renderWithQuery(
        <OrganisationProfileEditor
          organisation={null}
          projectDefaultOptions={[]}
          requestTypeOptions={[]}
          onSaved={vi.fn()}
          onReload={vi.fn()}
        />,
      );
      expect(
        Boolean(screen.queryByText("team:invitations.noEmailNotice")),
      ).toBe(visible);
      const link = screen.queryByRole("link", {
        name: "team:invitations.configureEmail",
      });
      if (visible)
        expect(link).toHaveAttribute("href", "/god-mode/notifications");
      else expect(link).toBeNull();
    },
  );

  it("keeps the queued invitation acknowledgement when navigation unmounts the editor", async () => {
    mocks.create.mockResolvedValue({
      profile: {
        id: "organisation-created",
        name: "New customer",
        key: "new-customer",
        emailDomains: [],
        portalAccess: true,
        defaultCustomerVisibility: "organisation",
        active: true,
        profileEtag: '"profile-v1"',
        quota: {
          maxProjects: 200,
          maxWorkItems: 500_000,
          maxStorageBytes: 21_474_836_480,
          maxPortalUsers: 500,
          maxApiRequestsPerMinute: 600,
          maxWebhooks: 10,
        },
        projectDefaults: [],
      },
      initialInvitation: {
        id: "invitation-1",
        status: "pending",
        expiresAt: "2026-10-27T00:00:00.000Z",
      },
    });
    let unmount = () => {};
    const view = renderWithQuery(
      <OrganisationProfileEditor
        organisation={null}
        projectDefaultOptions={[]}
        requestTypeOptions={[]}
        onSaved={async () => unmount()}
        onReload={vi.fn()}
      />,
    );
    unmount = view.unmount;

    fireEvent.change(screen.getByLabelText("nameLabel"), {
      target: { value: "New customer" },
    });
    fireEvent.change(screen.getByLabelText("keyLabel"), {
      target: { value: "new-customer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "createOrganisation" }));

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "initialInvitationQueued",
      );
    });
  });

  it("requires an explicit catalogue assignment and served workspace for initial contact", async () => {
    renderWithQuery(
      <OrganisationProfileEditor
        organisation={null}
        projectDefaultOptions={[
          {
            workspaceId: "workspace-service-desk",
            workspaceName: "Service Desk",
            serviceCalendars: [],
            slaPolicies: [],
          },
        ]}
        requestTypeOptions={[
          {
            id: "request-type-service",
            workspaceId: "workspace-service-desk",
            key: "service-request",
            name: "Service request",
            description: null,
            icon: null,
            group: "Support",
            autoAccept: false,
          },
        ]}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    const requestType = screen.getByRole("checkbox", {
      name: "Service request",
    });
    expect(requestType).toHaveAttribute("aria-checked", "false");

    const workspace = screen.getByRole("combobox", {
      name: "initialContactWorkspaceLabel",
    });
    expect(workspace).toBeDisabled();
    expect(workspace).toHaveTextContent("initialContactWorkspacePlaceholder");

    fireEvent.change(screen.getByLabelText("initialContactEmailLabel"), {
      target: { value: "contact@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "createOrganisation" }));
    expect(
      await screen.findByText("initialContactWorkspaceRequired"),
    ).toBeInTheDocument();

    fireEvent.click(requestType);
    expect(requestType).toHaveAttribute("aria-checked", "true");
    expect(workspace).toBeEnabled();
    expect(workspace).toHaveTextContent("initialContactWorkspacePlaceholder");
  });

  it("preserves invalid quota input and blocks saving until every limit is valid", async () => {
    renderWithQuery(
      <OrganisationProfileEditor
        organisation={null}
        projectDefaultOptions={[]}
        requestTypeOptions={[]}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    const maxProjects = screen.getByLabelText("quotaMaxProjects");
    fireEvent.change(maxProjects, { target: { value: "not-a-number" } });
    expect(maxProjects).toHaveValue("not-a-number");

    fireEvent.click(screen.getByRole("button", { name: "createOrganisation" }));
    expect(await screen.findByText("quotaInvalid")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("announces an existing profile save once through the save button", async () => {
    const organisation: OrganisationProfile = {
      id: "organisation-1",
      name: "Customer One",
      key: "customer-one",
      emailDomains: [],
      portalAccess: true,
      defaultCustomerVisibility: "organisation",
      active: true,
      profileEtag: '"profile-v1"',
      quota: {
        maxProjects: 20,
        maxWorkItems: 200,
        maxStorageBytes: 2048,
        maxPortalUsers: 30,
        maxApiRequestsPerMinute: 60,
        maxWebhooks: 5,
      },
      projectDefaults: [],
    };
    noticeState.hasSmtp = false;
    mocks.update.mockResolvedValue({ ...organisation, name: "Customer Two" });
    function Editor() {
      const [completed, setCompleted] = useState(false);
      return (
        <OrganisationProfileEditor
          organisation={organisation}
          projectDefaultOptions={[]}
          requestTypeOptions={[]}
          onSaved={async () => {}}
          onReload={vi.fn()}
          completed={completed}
          onSaveStart={() => setCompleted(false)}
          onSaveComplete={() => setCompleted(true)}
        />
      );
    }
    renderWithQuery(<Editor />);
    expect(screen.queryByText("team:invitations.noEmailNotice")).toBeNull();
    fireEvent.change(screen.getByLabelText("nameLabel"), {
      target: { value: "Customer Two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "profileSave" }));
    await screen.findByRole("button", { name: "common:actions.saved" });
    const announcements = screen
      .getAllByRole("status")
      .filter((node) => node.textContent?.trim());
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toHaveTextContent("common:actions.saved");
    expect(screen.getByText("profileSaved")).toHaveAttribute(
      "aria-live",
      "off",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("routes delete through the shared typed-name pending-action flow", async () => {
    const organisation: OrganisationProfile = {
      id: "organisation-1",
      name: "Customer One",
      key: "customer-one",
      emailDomains: [],
      portalAccess: true,
      defaultCustomerVisibility: "organisation",
      active: true,
      profileEtag: '"profile-v1"',
      quota: {
        maxProjects: 20,
        maxWorkItems: 200,
        maxStorageBytes: 2048,
        maxPortalUsers: 30,
        maxApiRequestsPerMinute: 60,
        maxWebhooks: 5,
      },
      projectDefaults: [],
    };
    mocks.delete.mockResolvedValue({ pendingActionId: "pending-1" });
    renderWithQuery(
      <OrganisationProfileEditor
        organisation={organisation}
        projectDefaultOptions={[]}
        requestTypeOptions={[]}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "deleteTitle" }));
    await waitFor(() => {
      expect(mocks.delete).toHaveBeenCalledWith(organisation.id);
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pending-1",
      });
    });
  });
});

describe("organisation project default labels", () => {
  it("shows names and unavailable state instead of opaque IDs", () => {
    const organisation: OrganisationProfile = {
      id: "organisation-1",
      name: "Customer",
      key: "customer",
      emailDomains: [],
      portalAccess: true,
      defaultCustomerVisibility: "organisation",
      active: true,
      profileEtag: '"profile-v1"',
      quota: {
        maxProjects: 20,
        maxWorkItems: 200,
        maxStorageBytes: 2048,
        maxPortalUsers: 30,
        maxApiRequestsPerMinute: 60,
        maxWebhooks: 5,
      },
      projectDefaults: [
        {
          workspaceId: "workspace-1",
          serviceCalendarId: "calendar-private-id",
          slaPolicyId: "sla-unpublished-id",
        },
      ],
    };
    renderWithQuery(
      <OrganisationProfileEditor
        organisation={organisation}
        projectDefaultOptions={[
          {
            workspaceId: "workspace-1",
            workspaceName: "Service Desk",
            serviceCalendars: [
              { id: "calendar-private-id", name: "Support hours" },
            ],
            slaPolicies: [
              {
                id: "sla-unpublished-id",
                name: "Legacy response target",
                published: false,
              },
            ],
          },
        ]}
        requestTypeOptions={[]}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "defaultCalendarLabel" }),
    ).toHaveTextContent("Support hours");
    expect(
      screen.getByRole("combobox", { name: "defaultSlaPolicyLabel" }),
    ).toHaveTextContent("Legacy response target (slaUnavailable)");
    expect(document.body).not.toHaveTextContent("calendar-private-id");
    expect(document.body).not.toHaveTextContent("sla-unpublished-id");
  });
});

describe("organisation profile heading order", () => {
  it("titles the card with an h2 so its h3 sections follow the page h1 in order", () => {
    renderWithQuery(
      <OrganisationProfileEditor
        organisation={null}
        projectDefaultOptions={[]}
        requestTypeOptions={[]}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "createTitle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "quotaTitle" }),
    ).toBeInTheDocument();
  });
});
