import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  saveComment: vi.fn(),
  saveTeamNotification: vi.fn(),
  selector: {
    eventKind: "work_item.mentioned",
    channel: "notify.email",
    scope: "global",
    scopeId: null as string | null,
  },
  invalidate: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock(
  "@/hooks/queries/notification-preferences/use-get-notification-preferences",
  () => ({
    default: () => ({
      isLoading: false,
      isError: false,
      data: {
        canonicalPreferences: [
          {
            eventKind: "work_item.mentioned",
            channel: "notify.email",
            scope: "global",
            scopeId: null,
            enabled: true,
            digest: "off",
            source: "global",
          },
          {
            eventKind: "work_item.commented",
            channel: "notify.email",
            scope: "global",
            scopeId: null,
            enabled: false,
            digest: "off",
            source: "default",
          },
          {
            eventKind: "automation.notification_sent",
            channel: "notify.email",
            scope: "global",
            scopeId: null,
            enabled: false,
            digest: "off",
            source: "default",
          },
        ],
      },
    }),
  }),
);
vi.mock(
  "@/fetchers/notification-preferences/canonical-mention-preference",
  () => ({
    getEmailLinkHandoff: vi.fn(),
    saveMentionEmailPreference: (value: boolean) => mocks.save(value),
    saveCommentEmailPreference: (value: boolean) => mocks.saveComment(value),
    saveTeamNotificationEmailPreference: (value: boolean) =>
      mocks.saveTeamNotification(value),
  }),
);
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.selector, isError: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
  }) => ({
    isPending: false,
    isError: false,
    mutate: (
      value: boolean,
      callbacks: { onSuccess: () => void; onError?: (error: unknown) => void },
    ) => void mutationFn(value).then(callbacks.onSuccess, callbacks.onError),
  }),
}));

import { CanonicalMentionPreference } from "./canonical-mention-preference";

afterEach(cleanup);
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({});
  mocks.saveComment.mockReset().mockResolvedValue({});
  mocks.saveTeamNotification.mockReset().mockResolvedValue({});
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.selector.scope = "global";
  mocks.selector.scopeId = null;
});
describe("email preference landing", () => {
  it("focuses the exact selector but never saves merely by opening it", () => {
    render(<CanonicalMentionPreference />);
    expect(
      screen.getByRole("switch", { name: "mention.enabled" }),
    ).toBeChecked();
    // S6/S7: no per-card save button; a preference saves when it changes.
    expect(screen.queryByRole("button", { name: "mention.save" })).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveClass("ring-ring");
  });
  it("saves a mention preference as soon as it is switched", async () => {
    render(<CanonicalMentionPreference />);
    fireEvent.click(screen.getByRole("switch", { name: "mention.enabled" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        enabled: false,
        digest: "off",
      }),
    );
    expect(await screen.findByText("mention.saved")).toBeInTheDocument();
  });
  it("switches back and says so when the save fails", async () => {
    mocks.save.mockReset().mockRejectedValue(new Error("offline"));
    render(<CanonicalMentionPreference />);
    const toggle = screen.getByRole("switch", { name: "mention.enabled" });
    fireEvent.click(toggle);
    expect(await screen.findByText("mention.saveFailed")).toBeInTheDocument();
    expect(toggle).toBeChecked();
  });
  it("saves hourly or daily cadence only for low-priority comments", async () => {
    render(<CanonicalMentionPreference />);
    fireEvent.click(screen.getByRole("switch", { name: "comment.enabled" }));
    await waitFor(() =>
      expect(mocks.saveComment).toHaveBeenCalledWith({
        enabled: true,
        digest: "off",
      }),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "comment.digest" }));
    const daily = await screen.findByRole("option", {
      name: "comment.digestCadence.daily",
    });
    fireEvent.pointerDown(daily);
    fireEvent.mouseDown(daily);
    fireEvent.pointerUp(daily);
    fireEvent.mouseUp(daily);
    fireEvent.click(daily);
    await waitFor(() =>
      expect(mocks.saveComment).toHaveBeenLastCalledWith({
        enabled: true,
        digest: "daily",
      }),
    );
  });
  it("saves a team notification email preference with its own cadence", async () => {
    render(<CanonicalMentionPreference />);
    fireEvent.click(
      screen.getByRole("switch", { name: "teamNotification.enabled" }),
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: "teamNotification.digest" }),
    );
    const hourly = await screen.findByRole("option", {
      name: "teamNotification.digestCadence.hourly",
    });
    fireEvent.pointerDown(hourly);
    fireEvent.mouseDown(hourly);
    fireEvent.pointerUp(hourly);
    fireEvent.mouseUp(hourly);
    fireEvent.click(hourly);
    await waitFor(() =>
      expect(mocks.saveTeamNotification).toHaveBeenLastCalledWith({
        enabled: true,
        digest: "hourly",
      }),
    );
  });
  it("states the email provider requirement once for all email preferences", () => {
    render(<CanonicalMentionPreference />);
    expect(screen.getAllByText("mention.providerRequired")).toHaveLength(1);
  });
  it("never translates an unsupported scoped link into a scoped mutation", () => {
    mocks.selector.scope = "project";
    mocks.selector.scopeId = "private-project";
    render(<CanonicalMentionPreference />);
    expect(screen.getByText("mention.unsupported")).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.activeElement).not.toHaveClass("ring-ring");
  });
});
