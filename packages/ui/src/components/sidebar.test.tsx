import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
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
  it("supports native scrolling without mounting the enhanced scroll area", () => {
    render(
      <SidebarProvider>
        <Sidebar
          closeLabel="Close"
          collapsible="icon"
          mobileDescription="The app sidebar"
          mobileTitle="Sidebar"
        >
          <SidebarContent nativeScroll>
            <a href="/work-items">Work items</a>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    const content = document.querySelector('[data-slot="sidebar-content"]');
    expect(content).not.toBeNull();
    expect(content).toHaveClass("overflow-y-auto");
    expect(content).toHaveAttribute("data-sidebar", "content");
    expect(content).toHaveTextContent("Work items");
    expect(
      document.querySelector('[data-slot="scroll-area-viewport"]'),
    ).not.toBeInTheDocument();
  });

  it("keeps the enhanced scroll area as the default", async () => {
    render(
      <SidebarProvider>
        <Sidebar
          closeLabel="Close"
          collapsible="icon"
          mobileDescription="The app sidebar"
          mobileTitle="Sidebar"
        >
          <SidebarContent>Work items</SidebarContent>
        </Sidebar>
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="scroll-area-viewport"]'),
      ).toBeInTheDocument();
    });
  });

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

  it("has no accessibility violations with a named navigation group", async () => {
    const { baseElement } = render(
      <SidebarProvider>
        <Sidebar
          closeLabel="Close navigation"
          collapsible="icon"
          mobileDescription="Navigate TaskDesk sections."
          mobileTitle="Main navigation"
        >
          <SidebarHeader>
            <strong>TaskDesk</strong>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive>Work items</SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <h1>Work items</h1>
        </SidebarInset>
      </SidebarProvider>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
