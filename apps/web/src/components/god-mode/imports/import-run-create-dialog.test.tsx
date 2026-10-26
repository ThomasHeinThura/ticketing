import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  projects: vi.fn(),
  canCreate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/god-mode/imports", () => ({
  createImportRun: (...args: unknown[]) => mocks.create(...args),
}));
vi.mock("@/fetchers/project/get-projects", () => ({
  default: (...args: unknown[]) => mocks.projects(...args),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canCreateTasks: mocks.canCreate,
  }),
}));

import { ImportRunCreateDialog } from "./import-run-create-dialog";

beforeEach(() => {
  mocks.create.mockReset();
  mocks.projects
    .mockReset()
    .mockResolvedValue([{ id: "project-1", name: "Support" }]);
  mocks.canCreate.mockReset().mockReturnValue(true);
});
afterEach(cleanup);

function renderDialog(onCreated = vi.fn()) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ImportRunCreateDialog
        workspaces={[{ id: "workspace-1", name: "Operations" }]}
        onClose={onClose}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onClose, onCreated };
}

describe("ImportRunCreateDialog", () => {
  it("creates only an import run and reuses the idempotency key on exact retry", async () => {
    const { onCreated } = renderDialog();
    mocks.create
      .mockRejectedValueOnce(new HttpError(500, "server failure"))
      .mockResolvedValue({ id: "run-1", state: "running" });

    const projectTrigger = await screen.findByRole("combobox", {
      name: "project",
    });
    fireEvent.click(projectTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Support" }));
    fireEvent.change(screen.getByLabelText("sourceRef"), {
      target: { value: "mcp:external-source-42" },
    });

    fireEvent.click(screen.getByRole("button", { name: "createSubmit" }));
    await screen.findByText("createErrorDescription");
    fireEvent.click(screen.getByRole("button", { name: "createSubmit" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    const [firstInput, firstKey] = mocks.create.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    const [retryInput, retryKey] = mocks.create.mock.calls[1] as [
      Record<string, unknown>,
      string,
    ];
    expect(firstInput).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-1",
      pluginId: "import.mcp",
      sourceRef: "mcp:external-source-42",
    });
    expect(retryInput).toEqual(firstInput);
    expect(retryKey).toBe(firstKey);
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.stringify(firstInput)).not.toContain("records");
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        { id: "run-1", state: "running" },
        firstKey,
        undefined,
        expect.any(Object),
      ),
    );
  });

  it("does not offer run creation without the live project create capability", async () => {
    mocks.canCreate.mockReturnValue(false);
    renderDialog();
    const projectTrigger = await screen.findByRole("combobox", {
      name: "project",
    });
    fireEvent.click(projectTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Support" }));
    fireEvent.change(screen.getByLabelText("sourceRef"), {
      target: { value: "mcp:external-source-42" },
    });
    expect(screen.getByRole("button", { name: "createSubmit" })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
