import { cleanup, render, screen } from "@testing-library/react";
import { Component, type ReactNode, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resettableLazy } from "./lazy-retry";

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p>failed</p>
    ) : (
      <Suspense fallback={<p>loading</p>}>{this.props.children}</Suspense>
    );
  }
}

afterEach(() => cleanup());

describe("resettableLazy", () => {
  it("imports afresh on the next render after a failed import", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError(
          "Failed to fetch dynamically imported module: /assets/app-sidebar.js",
        ),
      )
      .mockResolvedValueOnce({ default: () => <p>sidebar</p> });
    const Sidebar = resettableLazy(load);

    render(
      <Boundary>
        <Sidebar.Component />
      </Boundary>,
    );
    await screen.findByText("failed");
    cleanup();

    render(
      <Boundary>
        <Sidebar.Component />
      </Boundary>,
    );
    await screen.findByText("sidebar");
    expect(load).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("keeps a loaded component without importing again", async () => {
    const load = vi.fn().mockResolvedValue({ default: () => <p>projects</p> });
    const Projects = resettableLazy(load);
    render(<Projects.Component />, {
      wrapper: ({ children }) => <Suspense>{children}</Suspense>,
    });
    await screen.findByText("projects");
    cleanup();
    render(<Projects.Component />, {
      wrapper: ({ children }) => <Suspense>{children}</Suspense>,
    });
    await screen.findByText("projects");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
