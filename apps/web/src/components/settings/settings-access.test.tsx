import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * UAT re-audit: `useWorkspacePermission` keeps `isCheckingPermissions` true after the
 * `/api/capabilities` read fails (404 for an unknown or unreachable project, 5xx, network), so
 * every settings screen behind the access gate showed "Checking your access" forever with no
 * Retry. These run the real permission hook against a failing capabilities response.
 */
const mocks = vi.hoisted(() => ({
  capabilitiesGet: vi.fn(),
  getStateTemplates: vi.fn(),
  membershipLoading: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@taskdesk/libs", () => ({
  client: { capabilities: { $get: mocks.capabilitiesGet } },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({
    data: { role: "admin" },
    isLoading: mocks.membershipLoading,
  }),
}));
vi.mock("@/fetchers/project-settings-inheritance", () => ({
  getWorkspaceStateTemplates: mocks.getStateTemplates,
  createWorkspaceStateTemplate: vi.fn(),
  patchWorkspaceStateTemplate: vi.fn(),
  WorkspaceSettingsError: class extends Error {},
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));

import { SettingsAccessGate, useSettingsAccess } from "./settings-access";
import { WorkspaceStateTemplatesPanel } from "./workspace-state-templates-panel";

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

function SettingsScreen({ projectId }: { projectId?: string }) {
  const access = useSettingsAccess(
    (permission) => permission.canManageProjectSettings(),
    projectId,
  );
  return (
    <SettingsAccessGate access={access}>
      <p data-testid="settings-content">content</p>
    </SettingsAccessGate>
  );
}

beforeEach(() => {
  mocks.capabilitiesGet.mockReset();
  mocks.getStateTemplates.mockReset();
  mocks.membershipLoading = false;
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("settings access when the capability read fails", () => {
  it("offers Retry on a 500 instead of checking forever, then recovers", async () => {
    mocks.capabilitiesGet
      .mockResolvedValueOnce(respond(500))
      .mockResolvedValueOnce(respond(200, { manageProjectSettings: true }));
    renderWithClient(<SettingsScreen />);

    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings:accessDenied.loadErrorTitle",
    );
    expect(screen.queryByRole("status")).toBeNull();
    // Fails closed: the screen's own content (and so its queries) never renders.
    expect(screen.queryByTestId("settings-content")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.retry" }),
    );
    expect(await screen.findByTestId("settings-content")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-access-error")).toBeNull();
    expect(mocks.capabilitiesGet).toHaveBeenCalledTimes(2);
  });

  it("ends the check on a 404 for an unknown or unreachable project", async () => {
    mocks.capabilitiesGet.mockResolvedValue(respond(404));
    renderWithClient(<SettingsScreen projectId="bogus" />);

    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(mocks.capabilitiesGet).toHaveBeenCalledWith({
      query: { workspaceId: "ws-1", projectId: "bogus" },
    });
    expect(screen.queryByTestId("settings-content")).toBeNull();
  });

  it("still shows the denial when the read succeeds without the capability", async () => {
    mocks.capabilitiesGet.mockResolvedValue(
      respond(200, { manageProjectSettings: false }),
    );
    renderWithClient(<SettingsScreen projectId="p-1" />);
    expect(
      await screen.findByTestId("settings-access-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-access-error")).toBeNull();
  });

  it("does not report a failure for another project's capability read", async () => {
    mocks.capabilitiesGet.mockImplementation(
      async ({ query }: { query: { projectId?: string } }) =>
        query.projectId === "other"
          ? respond(500)
          : new Promise(() => {
              // This project's read never settles: it must stay "checking".
            }),
    );
    renderWithClient(
      <>
        <SettingsScreen projectId="other" />
        <SettingsScreen projectId="p-1" />
      </>,
    );
    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("settings-access-error")).toHaveLength(1);
    expect(
      await screen.findByRole("status", {
        name: "settings:accessDenied.checking",
      }),
    ).toBeInTheDocument();
  });
});

describe("WorkspaceStateTemplatesPanel when the capability read fails", () => {
  it("shows the access error with Retry, not a permanent skeleton", async () => {
    mocks.capabilitiesGet.mockResolvedValue(respond(503));
    renderWithClient(<WorkspaceStateTemplatesPanel workspaceId="ws-1" />);

    expect(
      await screen.findByTestId("settings-access-error"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-state-templates-loading"),
    ).toBeNull();
    expect(mocks.getStateTemplates).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "common:actions.retry" }),
      ).toBeEnabled(),
    );
  });
});

describe("settings access requiring a fresh capability on revisit", () => {
  it.each([
    ["request types", "manageRequestTypes"],
    ["terminology", "manageWorkspaceSettings"],
  ] as const)(
    "holds %s while membership loads and until the fresh capability settles",
    async (_name, flag) => {
      mocks.membershipLoading = true;
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      client.setQueryData(
        ["workspace-capabilities", "ws-1", "work-item-target"],
        { [flag]: true },
      );
      client.setQueryData(["workspace-capabilities", "ws-1", "admin"], {
        [flag]: true,
      });
      let resolve!: (value: ReturnType<typeof respond>) => void;
      mocks.capabilitiesGet.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const editorRequest = vi.fn();
      function Editor() {
        editorRequest();
        return <p>editor mounted</p>;
      }
      function Screen() {
        const access = useSettingsAccess(
          (permission) =>
            flag === "manageRequestTypes"
              ? permission.canManageRequestTypes()
              : permission.canManageWorkspaceSettings(),
          undefined,
          { refreshOnMount: true },
        );
        return (
          <SettingsAccessGate access={access}>
            <Editor />
          </SettingsAccessGate>
        );
      }
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
      expect(
        await screen.findByRole("status", {
          name: "settings:accessDenied.checking",
        }),
      ).toBeInTheDocument();
      expect(editorRequest).not.toHaveBeenCalled();
      expect(mocks.capabilitiesGet).not.toHaveBeenCalled();
      mocks.membershipLoading = false;
      rerender(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
      await waitFor(() =>
        expect(mocks.capabilitiesGet).toHaveBeenCalledTimes(1),
      );
      expect(
        await screen.findByRole("status", {
          name: "settings:accessDenied.checking",
        }),
      ).toBeInTheDocument();
      expect(editorRequest).not.toHaveBeenCalled();
      resolve(respond(200, { [flag]: false }));
      expect(
        await screen.findByTestId("settings-access-denied"),
      ).toBeInTheDocument();
      expect(editorRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["request types", "manageRequestTypes"],
    ["terminology", "manageWorkspaceSettings"],
  ] as const)(
    "keeps %s closed while offline and rechecks after reconnecting",
    async (_name, flag) => {
      onlineManager.setOnline(false);
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      client.setQueryData(["workspace-capabilities", "ws-1", "admin"], {
        [flag]: true,
      });
      mocks.capabilitiesGet.mockResolvedValue(respond(200, { [flag]: false }));
      const mounted = vi.fn();
      function Content() {
        mounted();
        return <p>protected content</p>;
      }
      function Screen() {
        const access = useSettingsAccess(
          (permission) =>
            flag === "manageRequestTypes"
              ? permission.canManageRequestTypes()
              : permission.canManageWorkspaceSettings(),
          undefined,
          { refreshOnMount: true },
        );
        return (
          <SettingsAccessGate access={access}>
            <Content />
          </SettingsAccessGate>
        );
      }
      render(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
      expect(
        await screen.findByRole("status", {
          name: "settings:accessDenied.checking",
        }),
      ).toBeInTheDocument();
      expect(mounted).not.toHaveBeenCalled();
      expect(mocks.capabilitiesGet).not.toHaveBeenCalled();
      onlineManager.setOnline(true);
      expect(
        await screen.findByTestId("settings-access-denied"),
      ).toBeInTheDocument();
      expect(mocks.capabilitiesGet).toHaveBeenCalledTimes(1);
      expect(mounted).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["request types", "manageRequestTypes"],
    ["terminology", "manageWorkspaceSettings"],
  ] as const)(
    "does not mount %s from a cached grant while it is revoked",
    async (_name, flag) => {
      let resolve!: (value: ReturnType<typeof respond>) => void;
      mocks.capabilitiesGet.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      client.setQueryData(["workspace-capabilities", "ws-1", "admin"], {
        [flag]: true,
      });
      const mounted = vi.fn();
      function Content() {
        mounted();
        return <p>protected content</p>;
      }
      function Screen() {
        const access = useSettingsAccess(
          (permission) =>
            flag === "manageRequestTypes"
              ? permission.canManageRequestTypes()
              : permission.canManageWorkspaceSettings(),
          undefined,
          { refreshOnMount: true },
        );
        return (
          <SettingsAccessGate access={access}>
            <Content />
          </SettingsAccessGate>
        );
      }
      render(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
      expect(
        await screen.findByRole("status", {
          name: "settings:accessDenied.checking",
        }),
      ).toBeInTheDocument();
      expect(mounted).not.toHaveBeenCalled();
      resolve(respond(200, { [flag]: false }));
      expect(
        await screen.findByTestId("settings-access-denied"),
      ).toBeInTheDocument();
      expect(mounted).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["request types", "manageRequestTypes"],
    ["terminology", "manageWorkspaceSettings"],
  ] as const)(
    "fails closed for %s when a cached grant cannot be refreshed",
    async (_name, flag) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      client.setQueryData(["workspace-capabilities", "ws-1", "admin"], {
        [flag]: true,
      });
      mocks.capabilitiesGet.mockResolvedValue(respond(503));
      const mounted = vi.fn();
      function Content() {
        mounted();
        return <p>protected content</p>;
      }
      function Screen() {
        const access = useSettingsAccess(
          (permission) =>
            flag === "manageRequestTypes"
              ? permission.canManageRequestTypes()
              : permission.canManageWorkspaceSettings(),
          undefined,
          { refreshOnMount: true },
        );
        return (
          <SettingsAccessGate access={access}>
            <Content />
          </SettingsAccessGate>
        );
      }
      render(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
      expect(
        await screen.findByTestId("settings-access-error"),
      ).toBeInTheDocument();
      expect(mounted).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["request types", "manageRequestTypes"],
    ["terminology", "manageWorkspaceSettings"],
  ] as const)(
    "keeps %s mounted through later background refetches and still honours a revoked grant",
    async (_name, flag) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      client.setQueryData(["workspace-capabilities", "ws-1", "admin"], {
        [flag]: true,
      });
      mocks.capabilitiesGet.mockResolvedValueOnce(
        respond(200, { [flag]: true }),
      );
      const mounted = vi.fn();
      const unmounted = vi.fn();
      function Content() {
        useEffect(() => {
          mounted();
          return () => unmounted();
        }, []);
        return <p>protected content</p>;
      }
      function Screen() {
        const access = useSettingsAccess(
          (permission) =>
            flag === "manageRequestTypes"
              ? permission.canManageRequestTypes()
              : permission.canManageWorkspaceSettings(),
          undefined,
          { refreshOnMount: true },
        );
        return (
          <SettingsAccessGate access={access}>
            <Content />
          </SettingsAccessGate>
        );
      }
      render(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
      expect(await screen.findByText("protected content")).toBeInTheDocument();
      expect(mocks.capabilitiesGet).toHaveBeenCalledTimes(1);
      expect(mounted).toHaveBeenCalledTimes(1);
      const refetch = () =>
        client.refetchQueries({ queryKey: ["workspace-capabilities", "ws-1"] });
      const stillOpen = () => {
        expect(screen.getByText("protected content")).toBeInTheDocument();
        expect(
          screen.queryByRole("status", {
            name: "settings:accessDenied.checking",
          }),
        ).not.toBeInTheDocument();
        expect(screen.queryByTestId("settings-access-error")).toBeNull();
        expect(unmounted).not.toHaveBeenCalled();
      };

      // A refetch in flight (reconnect, invalidation, Retry elsewhere).
      let resolve!: (value: ReturnType<typeof respond>) => void;
      mocks.capabilitiesGet.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = refetch();
      });
      await waitFor(() =>
        expect(mocks.capabilitiesGet).toHaveBeenCalledTimes(2),
      );
      stillOpen();
      await act(async () => {
        resolve(respond(200, { [flag]: true }));
        await pending;
      });
      stillOpen();

      // A refetch that fails keeps the last answer.
      mocks.capabilitiesGet.mockResolvedValueOnce(respond(503));
      await act(async () => {
        await refetch();
      });
      expect(mocks.capabilitiesGet).toHaveBeenCalledTimes(3);
      stillOpen();

      // A refetch that reports the grant revoked closes the screen.
      mocks.capabilitiesGet.mockResolvedValueOnce(
        respond(200, { [flag]: false }),
      );
      await act(async () => {
        await refetch();
      });
      expect(
        await screen.findByTestId("settings-access-denied"),
      ).toBeInTheDocument();
      expect(screen.queryByText("protected content")).toBeNull();
      expect(mounted).toHaveBeenCalledTimes(1);
    },
  );
});
