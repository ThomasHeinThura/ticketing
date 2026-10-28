import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LegacyProjectRealtime from "./legacy-project-realtime";

const realtimeState = vi.hoisted(() => ({
  status: "connecting" as "connecting" | "live" | "unavailable",
  projectId: "",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: () => "Realtime updates are unavailable" }),
}));

vi.mock("@/hooks/use-project-websocket", () => ({
  useProjectWebSocket: (projectId: string) => {
    realtimeState.projectId = projectId;
    return { status: realtimeState.status };
  },
}));

afterEach(() => {
  cleanup();
});

describe("LegacyProjectRealtime", () => {
  it("keeps the legacy socket topic and outage notice behavior", () => {
    realtimeState.status = "connecting";
    const { rerender } = render(
      <LegacyProjectRealtime projectId="project-1" />,
    );

    expect(realtimeState.projectId).toBe("project-1");
    expect(screen.queryByRole("status")).toBeNull();

    realtimeState.status = "live";
    rerender(<LegacyProjectRealtime projectId="project-1" />);
    expect(screen.queryByRole("status")).toBeNull();

    realtimeState.status = "unavailable";
    rerender(<LegacyProjectRealtime projectId="project-1" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Realtime updates are unavailable",
    );
  });
});
