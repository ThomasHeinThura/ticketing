import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  navigate: vi.fn(),
  policy: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/queries/sla-policy/use-sla-policy", () => ({
  useSlaPolicy: () => ({
    data: mocks.policy,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/service-calendar/use-service-calendars", () => ({
  useServiceCalendars: () => ({
    data: {
      data: [{ id: "calendar-1", name: "Business hours", timezone: "UTC" }],
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => [],
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageServiceCalendars: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/mutations/sla-policy/use-create-sla-policy", () => ({
  useCreateSlaPolicy: () => ({ mutateAsync: mocks.create, isPending: false }),
}));
vi.mock("@/hooks/mutations/sla-policy/use-update-sla-policy", () => ({
  useUpdateSlaPolicy: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock("@/hooks/mutations/sla-policy/use-publish-sla-policy", () => ({
  usePublishSlaPolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SlaPolicyEditor } from "./sla-policy-editor";

function renderEditor(id = "new") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SlaPolicyEditor id={id} />
    </QueryClientProvider>,
  );
}

async function selectCalendar() {
  fireEvent.click(screen.getByRole("combobox", { name: "editor.calendar" }));
  fireEvent.click(
    await screen.findByRole("option", { name: /Business hours/ }),
  );
}

beforeEach(() => {
  mocks.create
    .mockReset()
    .mockResolvedValue({ id: "policy-new", workspaceId: "workspace-1" });
  mocks.update.mockReset().mockResolvedValue({});
  mocks.navigate.mockReset();
  mocks.policy = null;
});
afterEach(cleanup);

describe("SLA policy stable keys", () => {
  it("validates and sends a stable key when creating a policy", async () => {
    renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "editor.name" }), {
      target: { value: "Priority response" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "editor.stableKeyLabel" }),
      { target: { value: "Bad_Key" } },
    );
    const keyInput = screen.getByRole("textbox", {
      name: "editor.stableKeyLabel",
    });
    await waitFor(() => expect(keyInput).toHaveValue("Bad_Key"));
    await selectCalendar();
    const saveButton = screen.getByRole("button", { name: "editor.save" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    expect(saveButton).toHaveAttribute("type", "submit");
    fireEvent.submit(saveButton.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(keyInput).toHaveAttribute("aria-invalid", "true"),
    );
    expect(
      await screen.findByText("editor.stableKeyInvalid"),
    ).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByRole("textbox", { name: "editor.stableKeyLabel" }),
      { target: { value: "priority_response" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "editor.save" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "priority_response",
          name: "Priority response",
          calendarId: "calendar-1",
        }),
      ),
    );
  });

  it("shows a saved key read-only and excludes it from policy updates", async () => {
    mocks.policy = {
      id: "policy-1",
      key: "response_sla",
      name: "Response SLA",
      description: null,
      version: 3,
      workspaceId: "workspace-1",
      activeVersion: null,
      draftVersion: {
        number: 3,
        calendarId: "calendar-1",
        atRiskThresholdPct: 75,
        goals: [],
      },
    };
    renderEditor("policy-1");
    const keyInput = await screen.findByRole("textbox", {
      name: "editor.stableKeyReadOnlyLabel",
    });
    expect(keyInput).toHaveValue("response_sla");
    expect(keyInput).toHaveAttribute("readonly");
    fireEvent.change(screen.getByRole("textbox", { name: "editor.name" }), {
      target: { value: "Updated response SLA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "editor.save" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({
      id: "policy-1",
      version: 3,
      data: expect.objectContaining({ name: "Updated response SLA" }),
    });
    expect(mocks.update.mock.calls[0]?.[0].data).not.toHaveProperty("key");
  });
});
