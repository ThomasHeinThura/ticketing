import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceCalendarEditorView } from "@/components/service-calendar/service-calendar-editor-view";
import type {
  CalendarMetadata,
  useServiceCalendarEditor,
} from "@/hooks/use-service-calendar-editor";
import { Route } from "@/routes/agent/_layout/_authenticated/dashboard/settings/workspace/general";

const mocks = vi.hoisted(() => ({
  workspace: { id: "ws", name: "Workspace" },
  checking: true,
  failed: false,
  mutate: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: () => null,
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: mocks.workspace }),
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: () => ({ error: { status: 403 } }),
}));
vi.mock("@/hooks/mutations/workspace/use-update-workspace", () => ({
  default: () => ({ mutateAsync: mocks.mutate }),
}));
vi.mock("@/hooks/mutations/workspace/use-delete-workspace", () => ({
  default: () => ({ mutateAsync: mocks.mutate }),
}));
vi.mock("@/hooks/mutations/workspace/use-transfer-workspace-ownership", () => ({
  default: () => ({ mutateAsync: mocks.mutate }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.mutate,
}));
vi.mock("@/hooks/use-step-up-action", () => ({ useStepUpAction: () => ({}) }));
vi.mock("@/components/settings/workspace-project-defaults-panel", () => ({
  WorkspaceProjectDefaultsPanel: () => null,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: mocks.checking,
    canManageWorkspace: () => false,
    canDeleteWorkspace: () => false,
  }),
}));
vi.mock("@/components/settings/settings-access", async (original) => ({
  ...(await original<typeof import("@/components/settings/settings-access")>()),
  useCapabilityCheckFailed: () => mocks.failed,
}));
function Calendar() {
  const form = useForm<CalendarMetadata>();
  const state = {
    calendarError: { status: 403 },
    isCheckingPermissions: mocks.checking,
    capabilityCheckFailed: mocks.failed,
  } as unknown as ReturnType<typeof useServiceCalendarEditor>;
  return (
    <ServiceCalendarEditorView
      state={state}
      isNew={false}
      year={2026}
      form={form}
      onYearChange={() => undefined}
    />
  );
}
afterEach(cleanup);
describe.each([
  ["calendar", Calendar, "serviceCalendars:editor.pageTitle"],
  [
    "workspace general",
    (Route as unknown as { component: ComponentType }).component,
    "settings:workspaceGeneral.title",
  ],
] as const)("%s early refusal", (_name, Page, title) => {
  it.each(["checking", "error", "denied"])(
    "%s has exactly one heading and no form or mutations",
    (state) => {
      mocks.checking = state !== "denied";
      mocks.failed = state === "error";
      mocks.mutate.mockClear();
      const { container } = render(
        <QueryClientProvider client={new QueryClient()}>
          <Page />
        </QueryClientProvider>,
      );
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        state === "denied" ? "states.noAccess.title" : title,
      );
      if (state === "checking")
        expect(screen.getByRole("status")).toBeInTheDocument();
      if (state === "error")
        expect(
          screen.getByRole("button", { name: "common:actions.retry" }),
        ).toBeEnabled();
      expect(container.querySelector("form")).toBeNull();
      expect(mocks.mutate).not.toHaveBeenCalled();
    },
  );
});

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/i18n", () => ({ i18n: { language: "en-US" } }));
