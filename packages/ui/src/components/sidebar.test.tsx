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

  // UAT re-audit: no skip link, the sidebar was not a nav landmark, one main per page.
  it("is a named nav landmark beside exactly one main", () => {
    render(
      <SidebarProvider>
        <Sidebar
          closeLabel="Close navigation"
          mobileDescription="Navigate TaskDesk sections."
          mobileTitle="Main navigation"
        >
          <SidebarContent nativeScroll>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Work items</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>content</SidebarInset>
      </SidebarProvider>,
    );
    expect(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("puts a skip link first that moves focus to main without touching the URL", async () => {
    const { baseElement } = render(
      <SidebarProvider skipLinkLabel="Skip to main content">
        <Sidebar
          closeLabel="Close navigation"
          mobileDescription="Navigate TaskDesk sections."
          mobileTitle="Main navigation"
        >
          <SidebarContent nativeScroll>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>Work items</SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <h1>Work items</h1>
        </SidebarInset>
      </SidebarProvider>,
    );
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    const firstFocusable = baseElement.querySelector(
      'a[href], button, input, [tabindex]:not([tabindex="-1"])',
    );
    expect(firstFocusable).toBe(skip);

    const hashBefore = window.location.hash;
    skip.focus();
    fireEvent.click(skip);
    const main = screen.getByRole("main");
    expect(main).toHaveFocus();
    expect(window.location.hash).toBe(hashBefore);
    // The temporary tabindex goes away once focus leaves, so clicks never focus main.
    fireEvent.blur(main);
    expect(main).not.toHaveAttribute("tabindex");
    await expectNoA11yViolations(baseElement);
  });

  it("renders no skip link unless the shell passes a label", () => {
    render(
      <SidebarProvider>
        <SidebarInset>content</SidebarInset>
      </SidebarProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

// UX-10: the agent shell switches to the off-canvas sheet below `lg` (1024 px) so a 768 px
// tablet gets the full width; other shells keep the 768 px default.
describe("SidebarProvider mobileBreakpoint", () => {
  const originalWidth = window.innerWidth;
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
  });

  function setWidth(width: number) {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
  }

  function renderShell(mobileBreakpoint?: number) {
    return render(
      <SidebarProvider mobileBreakpoint={mobileBreakpoint}>
        <Sidebar
          closeLabel="Close navigation"
          mobileDescription="Navigate TaskDesk sections."
          mobileTitle="Main navigation"
        >
          <SidebarContent nativeScroll>Work items</SidebarContent>
        </Sidebar>
        <SidebarInset>
          <SidebarTrigger toggleLabel="Toggle sidebar" />
          <StateReadout />
        </SidebarInset>
      </SidebarProvider>,
    );
  }

  it("uses the sheet below the given breakpoint without touching the persisted state", async () => {
    setWidth(768);
    renderShell(1024);
    expect(document.querySelector('[data-slot="sidebar"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    await waitFor(() => {
      expect(
        document.querySelector('[data-slot="sidebar"][data-mobile="true"]'),
      ).toBeInTheDocument();
    });
    // The desktop open/closed state (and its cookie) is left as it was.
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("keeps the docked sidebar from the given breakpoint up", () => {
    setWidth(1024);
    renderShell(1024);
    expect(
      document.querySelector('[data-slot="sidebar"]:not([data-mobile])'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
    expect(cookieStore.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: "sidebar_state", value: "false" }),
    );
  });

  it("keeps the 768 px default when no breakpoint is given", () => {
    setWidth(900);
    renderShell();
    expect(
      document.querySelector('[data-slot="sidebar"]:not([data-mobile])'),
    ).toBeInTheDocument();
  });
});
