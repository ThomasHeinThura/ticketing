import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: {
    user: { id: "u1" },
    session: { id: "s1" },
  } as { user: { id: string }; session: { id: string } } | null,
  rules: [] as Array<Record<string, unknown>>,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  toggle: vi.fn(),
  refresh: vi.fn(),
  guard: vi.fn(),
  history: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  network: vi.fn(),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: mocks.session }) },
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/profile-session-guard", () => ({
  profileSessionGuard: (...args: unknown[]) => mocks.guard(...args),
}));
vi.mock("@/components/settings/refresh-settings-history", () => ({
  refreshSettingsHistory: mocks.refresh,
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: (props: { type: string; id: string; userId: string }) => {
    mocks.history(props);
    return <div>History panel</div>;
  },
}));
vi.mock("@/fetchers/automation/automations", () => ({
  listAutomations: mocks.list,
  createAutomation: mocks.create,
  updateAutomation: mocks.update,
  setAutomationEnabled: mocks.toggle,
}));
vi.mock("./automation-editor-dialog", () => ({
  AutomationEditorDialog: (props: {
    rule?: { id: string };
    onSave: (input: unknown) => void;
  }) => (
    <Button type="button" onClick={() => props.onSave({ name: "Saved" })}>
      {props.rule ? "save-existing" : "save-new"}
    </Button>
  ),
}));
vi.mock("./automation-dry-run-dialog", () => ({
  AutomationDryRunDialog: () => null,
}));
vi.mock("./automation-runs-dialog", () => ({
  AutomationRunsDialog: () => <div>runs dialog</div>,
}));

import { AutomationRulesPanel } from "./automation-rules-panel";

const rule = (id: string, enabled = true) => ({
  id,
  name: `Rule ${id}`,
  enabled,
  trigger: "work_item.created",
  conditions: [],
  actions: [],
  flaggedReason: null,
  effectiveRoleName: "Agent",
  fireCount: 0,
  lastRunAt: null,
  version: 3,
});
const meta = { featureEnabled: true, assignableRoles: [{ id: "r1" }] };

function mount(canManage = true, scope: "workspace" | "project" = "workspace") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const panel = () => (
    <AutomationRulesPanel
      scope={
        scope === "workspace"
          ? { kind: "workspace", workspaceId: "ws" }
          : { kind: "project", projectKey: "KEY" }
      }
      workspaceId="ws"
      projectId={scope === "project" ? "p1" : null}
      canManage={canManage}
      title="title"
      description="description"
    />
  );
  const view = render(ui(panel()));
  return { client, rerender: () => view.rerender(ui(panel())) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.network);
  mocks.network.mockImplementation(() => {
    throw new Error("Unexpected network call");
  });
  mocks.session = { user: { id: "u1" }, session: { id: "s1" } };
  mocks.rules = [rule("a1"), rule("a2", false)];
  for (const fn of [
    mocks.create,
    mocks.update,
    mocks.toggle,
    mocks.refresh,
    mocks.guard,
    mocks.history,
    mocks.toast.success,
    mocks.toast.error,
  ])
    fn.mockReset();
  mocks.list.mockImplementation(async () => ({
    data: mocks.rules,
    meta,
  }));
  mocks.guard.mockReturnValue(async () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const keyFor = (id: string, user = "u1", session = "s1") => [
  "settings-history",
  "automation",
  id,
  "agent",
  user,
  session,
];

describe("automation rules panel History", () => {
  it("mounts History only for the clicked loaded rule with the session user", async () => {
    mount();
    await screen.findByText("Rule a1");
    expect(mocks.history).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getAllByText("list.changeHistory")[0] as HTMLElement,
    );
    await screen.findByText("History panel");
    expect(mocks.history).toHaveBeenCalledWith({
      type: "automation",
      id: "a1",
      userId: "u1",
    });
  });

  it("gives each rule's Change history button a distinct accessible name and opens its own target", async () => {
    mount();
    await screen.findByText("Rule a1");
    const first = screen.getByRole("button", {
      name: "changes.title:Rule a1",
    });
    const second = screen.getByRole("button", {
      name: "changes.title:Rule a2",
    });
    expect(first).not.toBe(second);
    // The visible text is unchanged; only the accessible name carries the rule.
    expect(first.textContent).toBe("list.changeHistory");
    fireEvent.click(second);
    await screen.findByText("History panel");
    expect(mocks.history).toHaveBeenLastCalledWith({
      type: "automation",
      id: "a2",
      userId: "u1",
    });
    expect(screen.getAllByText("changes.title:Rule a2").length).toBeGreaterThan(
      0,
    );
  });

  it("offers History to read-only roles without exposing edit controls", async () => {
    mount(false, "project");
    await screen.findByText("Rule a1");
    expect(screen.queryByText("list.edit")).toBeNull();
    expect(screen.queryByText("list.new")).toBeNull();
    fireEvent.click(
      screen.getAllByText("list.changeHistory")[1] as HTMLElement,
    );
    await screen.findByText("History panel");
    expect(mocks.history).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a2", userId: "u1" }),
    );
  });

  it("does not mount History without a session user", async () => {
    mocks.session = null;
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(
      screen.getAllByText("list.changeHistory")[0] as HTMLElement,
    );
    expect(screen.queryByText("History panel")).toBeNull();
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it("drops the dialog when the selected rule is no longer in the loaded list", async () => {
    const { client } = mount();
    await screen.findByText("Rule a1");
    fireEvent.click(
      screen.getAllByText("list.changeHistory")[0] as HTMLElement,
    );
    await screen.findByText("History panel");
    mocks.rules = [rule("a2", false)];
    await client.invalidateQueries({ queryKey: ["automations"] });
    await waitFor(() => expect(screen.queryByText("History panel")).toBeNull());
  });

  it("hides History when the session changes", async () => {
    const { rerender } = mount();
    await screen.findByText("Rule a1");
    fireEvent.click(
      screen.getAllByText("list.changeHistory")[0] as HTMLElement,
    );
    await screen.findByText("History panel");
    mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
    rerender();
    expect(screen.queryByText("History panel")).toBeNull();
    mocks.session = { user: { id: "u1" }, session: { id: "s1" } };
    rerender();
    expect(screen.queryByText("History panel")).toBeNull();
  });
});

describe("automation rules panel History refresh", () => {
  it("refreshes the returned id's exact key after a create", async () => {
    mocks.create.mockResolvedValue({ ...rule("new1"), id: "new1" });
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(await screen.findByText("list.new"));
    fireEvent.click(await screen.findByText("save-new"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.refresh.mock.calls[0]?.[1]).toEqual(keyFor("new1"));
    expect(mocks.guard).toHaveBeenCalledWith("u1", "s1");
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
  });

  it("refreshes after an update with the loaded version and the returned id", async () => {
    mocks.update.mockResolvedValue(rule("a1"));
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByText("list.edit")[0] as HTMLElement);
    fireEvent.click(await screen.findByText("save-existing"));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith("a1", {
      name: "Saved",
      version: 3,
    });
    expect(mocks.refresh.mock.calls[0]?.[1]).toEqual(keyFor("a1"));
  });

  it.each([
    [true, 1, "a2"],
    [false, 0, "a1"],
  ])("refreshes after enable=%s", async (enabled, index, id) => {
    mocks.toggle.mockResolvedValue(rule(id, enabled));
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByRole("switch")[index] as HTMLElement);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.toggle).toHaveBeenCalledWith(id, enabled, 3);
    expect(mocks.refresh.mock.calls[0]?.[1]).toEqual(keyFor(id));
  });

  it("does not refresh or report success when the write fails", async () => {
    mocks.toggle.mockRejectedValue(new Error("refused"));
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByRole("switch")[0] as HTMLElement);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("refused"),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("keeps the saved change successful while the refresh is still running", async () => {
    mocks.toggle.mockResolvedValue(rule("a1", false));
    mocks.refresh.mockReturnValue(new Promise(() => {}));
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByRole("switch")[0] as HTMLElement);
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
  });

  it("uses the session captured before the write, not one that changed during it", async () => {
    let finish!: (value: unknown) => void;
    mocks.toggle.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByRole("switch")[0] as HTMLElement);
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalled());
    mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
    finish(rule("a1", false));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.refresh.mock.calls[0]?.[1]).toEqual(keyFor("a1", "u1", "s1"));
    expect(mocks.guard).toHaveBeenCalledWith("u1", "s1");
  });

  it("skips the refresh without a session but still saves", async () => {
    mocks.session = null;
    mocks.toggle.mockResolvedValue(rule("a1", false));
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByRole("switch")[0] as HTMLElement);
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.network).not.toHaveBeenCalled();
  });
});
