import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CanonicalProjectRealtime from "./canonical-project-realtime";

const realtimeState = vi.hoisted(() => ({
  status: "connecting" as "connecting" | "available" | "unavailable" | "idle",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "Realtime updates are unavailable" }),
}));

vi.mock("@/hooks/use-native-work-item-realtime", () => ({
  useNativeWorkItemRealtime: (topics: readonly string[]) => {
    expect(topics).toEqual(["project:project-1"]);
    return {
      status: realtimeState.status,
      isUnavailable: realtimeState.status === "unavailable",
    };
  },
}));

afterEach(() => {
  cleanup();
});

describe("CanonicalProjectRealtime", () => {
  it("keeps the unavailable notice tied to the native project connection status", () => {
    realtimeState.status = "connecting";
    const { rerender } = render(
      <CanonicalProjectRealtime projectId="project-1" />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    realtimeState.status = "available";
    rerender(<CanonicalProjectRealtime projectId="project-1" />);
    expect(screen.queryByRole("status")).toBeNull();

    realtimeState.status = "unavailable";
    rerender(<CanonicalProjectRealtime projectId="project-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Realtime updates are unavailable",
    );
  });
});
