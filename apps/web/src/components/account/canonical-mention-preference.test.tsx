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
  }),
);
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.selector, isError: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (value: boolean) => Promise<unknown>;
  }) => ({
    isPending: false,
    isError: false,
    mutate: (value: boolean, callbacks: { onSuccess: () => void }) =>
      void mutationFn(value).then(callbacks.onSuccess),
  }),
}));

import { CanonicalMentionPreference } from "./canonical-mention-preference";

afterEach(cleanup);
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({});
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
    expect(screen.getByRole("button", { name: "mention.save" })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveClass("ring-ring");
  });
  it("requires an explicit change and save", async () => {
    render(<CanonicalMentionPreference />);
    fireEvent.click(screen.getByRole("switch", { name: "mention.enabled" }));
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "mention.save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(false));
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
