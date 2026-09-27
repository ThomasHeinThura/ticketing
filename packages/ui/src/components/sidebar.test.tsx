import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./sidebar";

// jsdom implements neither of these; SidebarProvider reads both (matchMedia via
// useIsMobile, cookieStore to persist the open/closed state).
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  vi.stubGlobal("cookieStore", { set: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function StateReadout() {
  const { state } = useSidebar();
  return <span data-testid="state">{state}</span>;
}

describe("useSidebar", () => {
  it("throws outside a SidebarProvider", () => {
    expect(() => render(<StateReadout />)).toThrow(
      /must be used within a SidebarProvider/,
    );
  });
});

describe("Sidebar", () => {
  it("starts expanded by default and collapses on trigger click", () => {
    render(
      <SidebarProvider>
        <Sidebar
          closeLabel="Close"
          collapsible="icon"
          mobileDescription="The app sidebar"
          mobileTitle="Sidebar"
        >
          <SidebarContent />
        </Sidebar>
        <SidebarTrigger toggleLabel="Toggle sidebar" />
        <StateReadout />
      </SidebarProvider>,
    );

    expect(screen.getByTestId("state")).toHaveTextContent("expanded");

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
  });
});
