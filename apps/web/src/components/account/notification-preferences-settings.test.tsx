import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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
let currentPreferences: Record<string, unknown> = preferences;
let currentWorkspaces: Array<{ id: string; name: string }> = [];

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<NotificationPreferencesSettings />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock(
  "@/hooks/queries/notification-preferences/use-get-notification-preferences",
  () => ({
    default: () => ({
      data: currentPreferences,
      isLoading: false,
    }),
  }),
);

vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: currentWorkspaces }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "project-one", name: "Project One" }] }),
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
    currentPreferences = preferences;
    currentWorkspaces = [];
    updatePreferences.mockReset();
    updatePreferences.mockResolvedValue(undefined);
    canonical.handoff.mockReset();
    canonical.handoff.mockResolvedValue(null);
    canonical.saveReportExport.mockReset();
    canonical.saveReportExport.mockResolvedValue({});
  });

  it("names channel switches, reminder units and the readonly account email without saving", () => {
    renderSettings();
    for (const channel of ["email", "gotify", "ntfy", "webhook"]) {
      expect(
        screen.getByRole("switch", {
          name: `settings:notificationsPage.${channel}Title`,
        }),
      ).toHaveAttribute("aria-checked", "false");
    }
    expect(
      screen.getByRole("combobox", {
        name: "settings:notificationsPage.reminderLeadTimeUnitLabel",
      }),
    ).toHaveTextContent("settings:notificationsPage.reminderLeadTimeUnitDays");
    const email = screen.getByLabelText(
      "settings:notificationsPage.accountEmailLabel",
    );
    expect(email).toHaveValue(preferences.emailAddress);
    expect(email).toBeDisabled();
    expect(email).toHaveAttribute("readonly");
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("saves an event switch as soon as it changes, with no save button", async () => {
    renderSettings();
    expect(
      screen.queryByRole("button", {
        name: "settings:notificationsPage.saveReminderLeadTime",
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventTaskAssignments",
      }),
    );
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        taskAssignmentEnabled: false,
      }),
    );
  });

  it("puts an event switch back when its save fails", async () => {
    updatePreferences.mockRejectedValue(new Error("offline"));
    renderSettings();
    const toggle = screen.getByRole("switch", {
      name: "settings:notificationsPage.eventComments",
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(updatePreferences).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("serializes overlapping event changes, including repeated changes to one switch", async () => {
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    updatePreferences.mockReturnValueOnce(firstWrite);
    renderSettings();
    const assignment = screen.getByRole("switch", {
      name: "settings:notificationsPage.eventTaskAssignments",
    });
    const comments = screen.getByRole("switch", {
      name: "settings:notificationsPage.eventComments",
    });
    fireEvent.click(assignment);
    fireEvent.click(comments);
    fireEvent.click(assignment);
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    expect(assignment).toHaveAttribute("aria-checked", "true");
    expect(comments).toHaveAttribute("aria-checked", "false");
    await act(async () => finishFirst());
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(3));
    expect(updatePreferences.mock.calls.map(([input]) => input)).toEqual([
      { taskAssignmentEnabled: false },
      { taskCommentEnabled: false },
      { taskAssignmentEnabled: true },
    ]);
  });

  it("keeps a newer switch choice when an earlier queued save fails", async () => {
    let failFirst!: (reason: Error) => void;
    updatePreferences.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        failFirst = reject;
      }),
    );
    renderSettings();
    const assignment = screen.getByRole("switch", {
      name: "settings:notificationsPage.eventTaskAssignments",
    });
    fireEvent.click(assignment);
    fireEvent.click(assignment);
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    await act(async () => failFirst(new Error("offline")));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    expect(assignment).toHaveAttribute("aria-checked", "true");
  });

  it("rolls back to the confirmed value if both queued choices fail", async () => {
    let failFirst!: (reason: Error) => void;
    updatePreferences
      .mockReturnValueOnce(
        new Promise<void>((_, reject) => {
          failFirst = reject;
        }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    renderSettings();
    const assignment = screen.getByRole("switch", {
      name: "settings:notificationsPage.eventTaskAssignments",
    });
    fireEvent.click(assignment);
    fireEvent.click(assignment);
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    await act(async () => failFirst(new Error("offline")));
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(assignment).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("preserves unrelated unsaved drafts when an autosave refetches preferences", async () => {
    const view = renderSettings();
    const lead = screen.getByLabelText(
      "settings:notificationsPage.reminderLeadTimeLabel",
    );
    const ntfyUrl = screen.getByPlaceholderText(
      "settings:notificationsPage.ntfyServerPlaceholder",
    );
    const ntfyToken = screen.getByPlaceholderText(
      "settings:notificationsPage.ntfyTokenPlaceholder",
    );
    const gotifyToken = screen.getByPlaceholderText(
      "settings:notificationsPage.gotifyTokenPlaceholder",
    );
    const webhookSecret = screen.getByPlaceholderText(
      "settings:notificationsPage.webhookSecretPlaceholder",
    );
    fireEvent.change(lead, { target: { value: "2" } });
    fireEvent.change(ntfyUrl, { target: { value: "https://example.test" } });
    fireEvent.change(ntfyToken, { target: { value: "ntfy draft" } });
    fireEvent.change(gotifyToken, { target: { value: "gotify draft" } });
    fireEvent.change(webhookSecret, { target: { value: "webhook draft" } });
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventComments",
      }),
    );
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        taskCommentEnabled: false,
      }),
    );
    currentPreferences = { ...preferences, taskCommentEnabled: false };
    view.rerender(<NotificationPreferencesSettings />);
    await waitFor(() => expect(lead).toHaveValue("2"));
    expect(ntfyUrl).toHaveValue("https://example.test");
    expect(ntfyToken).toHaveValue("ntfy draft");
    expect(gotifyToken).toHaveValue("gotify draft");
    expect(webhookSecret).toHaveValue("webhook draft");
    expect(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventComments",
      }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("keeps an unsaved workspace rule draft through an unrelated event refetch", async () => {
    currentWorkspaces = [{ id: "workspace-one", name: "Workspace One" }];
    const rule = {
      workspaceId: "workspace-one",
      isActive: true,
      emailEnabled: false,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: false,
      projectMode: "all" as const,
      selectedProjectIds: [],
    };
    currentPreferences = {
      ...preferences,
      emailEnabled: true,
      workspaces: [rule],
    };
    const view = renderSettings();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.workspaceCardLabelEmail",
      }),
    );
    fireEvent.click(
      screen.getByRole("radio", {
        name: /settings:notificationsPage.selectedProjects/,
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Project One" }));
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.eventComments",
      }),
    );
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        taskCommentEnabled: false,
      }),
    );
    currentPreferences = {
      ...preferences,
      emailEnabled: true,
      taskCommentEnabled: false,
      workspaces: [{ ...rule, selectedProjectIds: [] }],
    };
    view.rerender(<NotificationPreferencesSettings />);
    expect(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.workspaceCardLabelEmail",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: "Project One" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("does not clear a newer secret entered while its previous value is saving", async () => {
    let finish!: () => void;
    updatePreferences.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderSettings();
    const token = screen.getByPlaceholderText(
      "settings:notificationsPage.ntfyTokenPlaceholder",
    );
    fireEvent.change(token, { target: { value: "first secret" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.connectNtfy",
      }),
    );
    await waitFor(() => expect(updatePreferences).toHaveBeenCalledTimes(1));
    fireEvent.change(token, { target: { value: "new draft" } });
    await act(async () => finish());
    expect(token).toHaveValue("new draft");
  });

  it("offers a save for the reminder lead time only once it changed", async () => {
    renderSettings();
    fireEvent.change(
      screen.getByLabelText("settings:notificationsPage.reminderLeadTimeLabel"),
      { target: { value: "2" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:notificationsPage.saveReminderLeadTime",
      }),
    );
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
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
        name: "settings:notificationsPage.saveReminderLeadTime",
      }),
    ).toHaveProperty("disabled", true);
  });

  it("turns reminders off without validating their retained lead time", async () => {
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

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        dueDateReminderEnabled: false,
      }),
    );
  });

  it("saves the email channel switch as soon as it changes", async () => {
    renderSettings();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.emailTitle",
      }),
    );
    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({ emailEnabled: true }),
    );
    const emailCard = document.querySelector('[data-channel="email"]');
    expect(emailCard?.querySelector("button")).toBeNull();
  });

  it("saves the report.export_ready email preference on its own as soon as it changes (P5-R3-02)", async () => {
    renderSettings();
    const block = screen.getByTestId("report-export-email-preference");
    expect(
      screen.queryByRole("button", {
        name: "settings:notificationsPage.reportExportSave",
      }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:notificationsPage.reportExportEmail",
      }),
    );
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
