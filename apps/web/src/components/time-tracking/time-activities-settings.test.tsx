import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeActivitiesSettings } from "./time-activities-settings";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-one" }, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canLogTime: () => true,
    canManageWorkspaceSettings: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/time-tracking/use-time-tracking", () => ({
  useTimeActivities: () => ({
    data: [{ id: "activity-one", name: "Support", archived: false }],
    isLoading: false,
    isError: false,
  }),
  timeKeys: { all: ["time"] },
}));
vi.mock("@/fetchers/time-tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/time-tracking")>()),
  updateTimeActivity: mocks.update,
}));
vi.mock("./time-settings", () => ({
  AvailableHoursSetting: () => null,
  BackdateLimitSetting: () => null,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("time activity saves", () => {
  it("withdraws the done state when the name is edited again", async () => {
    mocks.update.mockResolvedValueOnce({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimeActivitiesSettings />
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText("timeTracking:activities.nameLabel");
    fireEvent.change(input, { target: { value: "Support work" } });
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:actions.save" }),
    );
    await screen.findByText("common:actions.saved", {
      selector: '[role="status"]',
    });
    fireEvent.change(input, { target: { value: "Support work again" } });
    await waitFor(() =>
      expect(
        screen.queryByText("common:actions.saved", {
          selector: '[role="status"]',
        }),
      ).toBeNull(),
    );
  });
  it("locks rename while archiving and allows it afterward without a double submit", async () => {
    let resolveArchive: (value: unknown) => void = () => {};
    let resolveRename: (value: unknown) => void = () => {};
    mocks.update
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveArchive = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRename = resolve;
          }),
      );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimeActivitiesSettings />
      </QueryClientProvider>,
    );
    fireEvent.change(
      screen.getByLabelText("timeTracking:activities.nameLabel"),
      { target: { value: "Support work" } },
    );
    const rename = screen.getByRole("button", {
      name: "timeTracking:actions.save",
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "timeTracking:activities.active" }),
    );
    await waitFor(() => expect(rename).toBeDisabled());
    fireEvent.click(rename);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenNthCalledWith(
      1,
      "activity-one",
      "workspace-one",
      { archived: true },
    );
    await act(async () => resolveArchive({}));
    await waitFor(() => expect(rename).toBeEnabled());
    fireEvent.click(rename);
    await waitFor(() => expect(rename).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(rename);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenNthCalledWith(
      2,
      "activity-one",
      "workspace-one",
      { name: "Support work" },
    );
    await act(async () => resolveRename({}));
  });
});
