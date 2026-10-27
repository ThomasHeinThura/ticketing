import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferencesSettings } from "./notification-preferences-settings";

const updatePreferences = vi.fn();
const preferences = {
  emailAddress: "mina@example.com",
  emailEnabled: false,
  ntfyEnabled: false,
  ntfyConfigured: false,
  ntfyServerUrl: null,
  ntfyTopic: null,
  ntfyTokenConfigured: false,
  maskedNtfyToken: null,
  gotifyEnabled: false,
  gotifyConfigured: false,
  gotifyServerUrl: null,
  gotifyTokenConfigured: false,
  maskedGotifyToken: null,
  webhookEnabled: false,
  webhookConfigured: false,
  webhookUrl: null,
  webhookSecretConfigured: false,
  maskedWebhookSecret: null,
  taskAssignmentEnabled: true,
  taskCommentEnabled: true,
  taskStatusChangeEnabled: true,
  dueDateReminderEnabled: true,
  dueDateReminderLeadTimeMinutes: 1440,
  workspaces: [],
  createdAt: null,
  updatedAt: null,
  canonicalPreferences: [
    {
      eventKind: "report.export_ready",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
      enabled: true,
      digest: "off",
      source: "default",
    },
  ],
};

const canonical = vi.hoisted(() => ({
  handoff: vi.fn(),
  saveReportExport: vi.fn(),
}));
vi.mock(
  "@/fetchers/notification-preferences/canonical-mention-preference",
  () => ({
    getEmailLinkHandoff: canonical.handoff,
    saveReportExportEmailPreference: canonical.saveReportExport,
  }),
);

function renderSettings() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NotificationPreferencesSettings />
    </QueryClientProvider>,
  );
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock(
  "@/hooks/queries/notification-preferences/use-get-notification-preferences",
  () => ({
    default: () => ({
      data: preferences,
      isLoading: false,
    }),
  }),
);

vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: [] }),
}));

vi.mock(
  "@/hooks/mutations/notification-preferences/use-notification-preferences",
  () => ({
    useUpdateNotificationPreferences: () => ({
      mutateAsync: updatePreferences,
      isPending: false,
    }),
    useUpsertNotificationWorkspaceRule: () => ({ mutateAsync: vi.fn() }),
    useDeleteNotificationWorkspaceRule: () => ({ mutateAsync: vi.fn() }),
  }),
);

describe("NotificationPreferencesSettings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    updatePreferences.mockReset();
    updatePreferences.mockResolvedValue(undefined);
    canonical.handoff.mockReset();
    canonical.handoff.mockResolvedValue(null);
    canonical.saveReportExport.mockReset();
    canonical.saveReportExport.mockResolvedValue({});
  });

  it("saves event preferences and a configurable reminder lead time", async () => {
    renderSettings();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventTaskAssignments",
      }),
    );
    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel"),
      { target: { value: "2" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveEventPreferences",
      }),
    );

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        taskAssignmentEnabled: false,
        taskCommentEnabled: true,
        taskStatusChangeEnabled: true,
        dueDateReminderEnabled: true,
        dueDateReminderLeadTimeMinutes: 2880,
      }),
    );
  });

  it("blocks saving a cleared reminder lead time", () => {
    renderSettings();

    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel"),
      { target: { value: "" } },
    );

    expect(
      screen.getByText("settings:notificationsPage.reminderLeadTimeInvalid"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveEventPreferences",
      }),
    ).toHaveProperty("disabled", true);
  });

  it("saves disabled reminders without validating their retained lead time", async () => {
    renderSettings();

    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel"),
      { target: { value: "0" } },
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventDueDateReminders",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveEventPreferences",
      }),
    );

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        taskAssignmentEnabled: true,
        taskCommentEnabled: true,
        taskStatusChangeEnabled: true,
        dueDateReminderEnabled: false,
      }),
    );
  });

  it("offers the report.export_ready email preference and saves it on its own (P5-R3-02)", async () => {
    renderSettings();
    const block = screen.getByTestId("report-export-email-preference");
    const save = screen.getByRole("button", {
      name: "settings:notificationsPage.reportExportSave",
    });
    // Default on, nothing to save until it changes.
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.reportExportEmail",
      }),
    );
    fireEvent.click(save);
    await waitFor(() =>
      expect(canonical.saveReportExport).toHaveBeenCalledTimes(1),
    );
    expect(canonical.saveReportExport.mock.calls[0]?.[0]).toEqual({
      enabled: false,
    });
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(block).toBeTruthy();
  });

  it("highlights the export preference when the email's preference link opened the page", async () => {
    canonical.handoff.mockResolvedValue({
      eventKind: "report.export_ready",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
    });
    renderSettings();
    await waitFor(() =>
      expect(
        screen
          .getByTestId("report-export-email-preference")
          .className.includes("ring-2"),
      ).toBe(true),
    );
  });
});
