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
  rules: [] as Array<Record<string, unknown>>,
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  toggle: vi.fn(),
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
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: (props: { target: unknown }) => {
    mocks.history(props.target);
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
  mocks.rules = [rule("a1"), rule("a2", false)];
  for (const fn of [
    mocks.create,
    mocks.update,
    mocks.toggle,
    mocks.history,
    mocks.toast.success,
    mocks.toast.error,
  ])
    fn.mockReset();
  mocks.list.mockImplementation(async () => ({
    data: mocks.rules,
    meta,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const target = (
  id: string,
  scope: unknown = { kind: "workspace", workspaceId: "ws" },
) => ({
  kind: "entity",
  type: "automation",
  id,
  scope,
});

/** The targets the global MutationCache would withdraw for the last mutation. */
const auditedTargets = (
  client: QueryClient,
  variables: unknown,
  result: unknown,
) =>
  client
    .getMutationCache()
    .getAll()
    .at(-1)
    ?.options.meta?.audits?.targets(variables as never, result as never);

describe("automation rules panel History", () => {
  it("mounts History only for the clicked loaded rule", async () => {
    mount();
    await screen.findByText("Rule a1");
    expect(mocks.history).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getAllByText("list.changeHistory")[0] as HTMLElement,
    );
    const history = await screen.findByText("History panel");
    expect(history.closest('[data-slot="dialog-panel"]')).not.toBeNull();
    expect(mocks.history).toHaveBeenCalledWith(target("a1"));
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
    expect(mocks.history).toHaveBeenLastCalledWith(target("a2"));
    expect(screen.getAllByText("changes.title:Rule a2").length).toBeGreaterThan(
      0,
    );
  });

  it("offers History to read-only roles on a project, scoped to that project", async () => {
    mount(false, "project");
    await screen.findByText("Rule a1");
    expect(screen.queryByText("list.edit")).toBeNull();
    expect(screen.queryByText("list.new")).toBeNull();
    fireEvent.click(
      screen.getAllByText("list.changeHistory")[1] as HTMLElement,
    );
    await screen.findByText("History panel");
    expect(mocks.history).toHaveBeenCalledWith(
      target("a2", { kind: "project", workspaceId: "ws", projectId: "p1" }),
    );
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
});

describe("automation rules panel audited saves", () => {
  it("declares the returned id as the History target after a create", async () => {
    mocks.create.mockResolvedValue({ ...rule("new1"), id: "new1" });
    const { client } = mount();
    await screen.findByText("Rule a1");
    fireEvent.click(await screen.findByText("list.new"));
    fireEvent.click(await screen.findByText("save-new"));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(auditedTargets(client, {}, rule("new1"))).toEqual([target("new1")]);
  });

  it("updates with the loaded version and declares the returned id", async () => {
    mocks.update.mockResolvedValue(rule("a1"));
    const { client } = mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByText("list.edit")[0] as HTMLElement);
    fireEvent.click(await screen.findByText("save-existing"));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith("a1", {
      name: "Saved",
      version: 3,
    });
    expect(auditedTargets(client, {}, rule("a1"))).toEqual([target("a1")]);
  });

  it.each([
    [true, 1, "a2"],
    [false, 0, "a1"],
  ])(
    "declares the toggled rule after enable=%s",
    async (enabled, index, id) => {
      mocks.toggle.mockResolvedValue(rule(id, enabled));
      const { client } = mount();
      await screen.findByText("Rule a1");
      fireEvent.click(screen.getAllByRole("switch")[index] as HTMLElement);
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
      expect(mocks.toggle).toHaveBeenCalledWith(id, enabled, 3);
      expect(auditedTargets(client, {}, rule(id, enabled))).toEqual([
        target(id),
      ]);
    },
  );

  it("reports the error and no success when the write fails", async () => {
    mocks.toggle.mockRejectedValue(new Error("refused"));
    mount();
    await screen.findByText("Rule a1");
    fireEvent.click(screen.getAllByRole("switch")[0] as HTMLElement);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("refused"),
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
