import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import RealtimeUnavailableNotice from "./realtime-unavailable-notice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => translate(key),
  }),
}));

afterEach(cleanup);

describe("RealtimeUnavailableNotice", () => {
  it("states that live updates are unavailable and the page keeps refreshing, as a status", () => {
    render(<RealtimeUnavailableNotice status="unavailable" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Live updates are unavailable. This page refreshes every 30 seconds while open.",
    );
    expect(screen.getByTestId("realtime-unavailable")).toBeInTheDocument();
  });

  it.each(["connecting", "live"] as const)(
    "shows nothing while %s",
    (status) => {
      render(<RealtimeUnavailableNotice status={status} />);
      expect(screen.queryByTestId("realtime-unavailable")).toBeNull();
    },
  );
});
