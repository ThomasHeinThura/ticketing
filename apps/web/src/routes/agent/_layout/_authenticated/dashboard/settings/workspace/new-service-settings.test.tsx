import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: false,
  checking: false,
  id: "new",
  calendar: vi.fn(),
  policy: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    fullPath: "/settings",
    useParams: () => ({ id: state.id }),
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageServiceCalendars: () => state.allowed,
    isCheckingPermissions: state.checking,
  }),
}));
vi.mock("@/hooks/use-service-calendar-editor", () => ({
  useServiceCalendarEditor: () => {
    state.calendar();
    return { form: {} };
  },
}));
vi.mock("@/components/service-calendar/service-calendar-editor-view", () => ({
  ServiceCalendarEditorView: () => <p>Calendar editor</p>,
}));
vi.mock("@/components/sla-policy/sla-policy-editor", () => ({
  SlaPolicyEditor: () => {
    state.policy();
    return <p>Policy editor</p>;
  },
}));
vi.mock("@/lib/server-clock", () => ({
  useServerToday: () => new Date("2026-11-12T00:00:00Z"),
}));

import { Route as CalendarRoute } from "./calendars/$id";
import { Route as PolicyRoute } from "./sla-policies/$id";

const Calendar = (CalendarRoute as unknown as { component: ComponentType })
  .component;
const Policy = (PolicyRoute as unknown as { component: ComponentType })
  .component;
function show(Page: ComponentType) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  state.allowed = false;
  state.checking = false;
  state.id = "new";
  state.calendar.mockClear();
  state.policy.mockClear();
});
describe.each([
  ["calendar", Calendar, state.calendar],
  ["policy", Policy, state.policy],
] as const)("new %s access", (_name, Page, editor) => {
  it("shows no access without the manage capability", () => {
    show(Page);
    expect(
      screen.getByRole("heading", { level: 1, name: "states.noAccess.title" }),
    ).toHaveFocus();
    expect(editor).not.toHaveBeenCalled();
  });
  it("waits for capability loading", async () => {
    state.checking = true;
    show(Page);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
    expect(editor).not.toHaveBeenCalled();
  });
  it("opens the editor for a manager", () => {
    state.allowed = true;
    show(Page);
    expect(editor).toHaveBeenCalled();
  });
  it("keeps existing readable records available without manage permission", () => {
    state.id = "existing";
    show(Page);
    expect(editor).toHaveBeenCalled();
  });
});
