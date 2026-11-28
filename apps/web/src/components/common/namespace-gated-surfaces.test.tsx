import en from "@i18n/en-US.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, type i18n as I18n } from "i18next";
import type { ReactNode } from "react";
import {
  I18nextProvider,
  initReactI18next,
  useTranslation,
} from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import usePendingActionDialogStore from "@/store/pending-action-dialog";

const loader = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/attachment/work-item-attachments", () => ({
  resumeWorkItemAttachment: uploadMock,
}));
vi.mock("@/lib/i18n", () => ({
  whenAllNamespacesLoaded: loader,
  areAllNamespacesLoaded: () => false,
}));

/** Stands in for each real surface body: it reads one split-out key, as the real one does. */
function reads(key: string) {
  return function Surface() {
    const { t } = useTranslation();
    return <p>{t(key)}</p>;
  };
}
vi.mock("@/components/work-item/work-item-context-menu-content", () => ({
  default: reads("tasksExtra:contextMenu.copyLink"),
}));
vi.mock("@/components/work-item/work-item-side-pane-body", () => ({
  default: reads("workItemsExtra:relations.add"),
}));
vi.mock("@/components/pending-action/pending-action-approval", () => ({
  PendingActionApproval: reads("tasksExtra:delete.action"),
}));
vi.mock(
  "@/components/pending-action/pending-action-terminology-boundary",
  () => ({
    PendingActionTerminologyBoundary: ({ children }: { children: ReactNode }) =>
      children,
  }),
);
vi.mock("@/components/shared/modals/create-workspace-modal", () => ({
  default: reads("workspace:create.ownerLabel"),
}));
vi.mock("@/components/work-item/create-work-item-dialog-form", () => ({
  default: reads("tasksExtra:popover.labels.updateError"),
}));

const SURFACES = [
  {
    name: "work-item context menu",
    text: /^Copy link$/,
    rawKey: "contextMenu.copyLink",
    mount: async () => {
      const { default: Menu } = await import(
        "@/components/work-item/work-item-context-menu"
      );
      const row = {
        id: "row",
        key: "PROJ-1",
        workspaceId: "w",
        projectId: "p",
        unavailableFields: [],
      };
      render(
        <Menu items={[row as never]}>
          <div>
            <div data-task-id="row">
              <Button type="button">Real row</Button>
            </div>
          </div>
        </Menu>,
        { wrapper: Wrapper },
      );
    },
    after: () =>
      fireEvent.contextMenu(screen.getByRole("button", { name: "Real row" })),
  },
  {
    name: "side pane (including header actions)",
    text: /^Add relation$/,
    rawKey: "relations.add",
    mount: async () => {
      const { default: Pane } = await import(
        "@/components/work-item/work-item-side-pane"
      );
      return render(<Pane itemKey="PROJ-1" onClose={() => undefined} />, {
        wrapper: Wrapper,
      });
    },
  },
  {
    name: "deletion approval",
    text: /^Delete/,
    rawKey: "delete.action",
    mount: async () => {
      const { default: Dialog } = await import(
        "@/components/pending-action/pending-action-approval-dialog"
      );
      usePendingActionDialogStore.getState().open("action-1");
      return render(<Dialog />, { wrapper: Wrapper });
    },
  },
  {
    name: "create workspace dialog",
    text: new RegExp(`^${en.workspace.create.ownerLabel}$`),
    rawKey: "create.ownerLabel",
    mount: async () => {
      const { default: Gate } = await import(
        "@/components/shared/modals/create-workspace-modal-gate"
      );
      return render(<Gate onClose={() => undefined} />, { wrapper: Wrapper });
    },
  },
  {
    name: "create work item form (label failure text)",
    text: /^Failed to update label$/,
    rawKey: "popover.labels.updateError",
    mount: async () => {
      const { CreateWorkItemDialogContent } = await import(
        "@/components/work-item/create-work-item-dialog"
      );
      return render(
        <CreateWorkItemDialogContent
          onClose={() => undefined}
          onCancel={() => undefined}
          onDraftStateChange={() => undefined}
          projectId="p"
          workspaceId="w"
        />,
        { wrapper: Wrapper },
      );
    },
  },
] as const;

let instance: I18n;
let resolve: () => void;
let reject: (error: Error) => void;
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={instance}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

/** Only the eager namespaces are loaded; the deferred group arrives on `release`. */
async function eagerOnly() {
  instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: "en-US",
    fallbackLng: "en-US",
    resources: {
      "en-US": { common: en.common, workItems: en.workItems, tasks: en.tasks },
      "de-DE": { common: en.common, workItems: en.workItems, tasks: en.tasks },
    },
    defaultNS: "common",
    react: { bindI18nStore: "added" },
    interpolation: { escapeValue: false },
  });
}
async function release(language = "en-US") {
  await act(async () => {
    instance.addResourceBundle(language, "tasksExtra", en.tasksExtra);
    instance.addResourceBundle(language, "workItemsExtra", en.workItemsExtra);
    instance.addResourceBundle(language, "workspace", en.workspace);
    resolve();
  });
}

beforeEach(async () => {
  await eagerOnly();
  loader.mockReset();
  loader.mockImplementation(
    () =>
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
});
afterEach(() => {
  cleanup();
  usePendingActionDialogStore.getState().close();
});

describe.each(SURFACES)("$name", (surface) => {
  const { mount, text, rawKey } = surface;
  const show = async () => {
    await act(async () => {
      await mount();
    });
    if ("after" in surface) surface.after();
  };
  // i18next renders a missing key as its path; hidden (inactive) content may carry it, visible
  // content must not.
  const noRawKey = () => {
    for (const element of screen.queryAllByText(rawKey))
      expect(element).not.toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /(?:tasksExtra|workItemsExtra|workspace):/,
    );
  };

  it("shows a translated loading state and no raw key until the catalog loads, then the real text", async () => {
    await show();
    expect(screen.queryByText(text)).not.toBeInTheDocument();
    noRawKey();
    for (const status of screen.queryAllByRole("status"))
      expect(status.getAttribute("aria-label") ?? "").not.toMatch(/:/);
    await release();
    expect(await screen.findByText(text)).toBeVisible();
  });

  it("shows a translated failure, retries and then reveals the real text", async () => {
    await show();
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.common.error.messages.unknown,
    );
    noRawKey();
    fireEvent.click(
      screen.getByRole("button", { name: en.common.actions.retry }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    noRawKey();
    await release();
    expect(await screen.findByText(text)).toBeVisible();
  });

  it("keeps the revealed surface mounted on a language change, falling back without a raw key", async () => {
    await show();
    await release();
    expect(await screen.findByText(text)).toBeVisible();
    await act(async () => {
      await instance.changeLanguage("de-DE");
    });
    // The new catalog is still missing: the loaded fallback language shows, never a raw key.
    expect(screen.getByText(text)).toBeVisible();
    noRawKey();
    await act(async () => {
      instance.addResourceBundle("de-DE", "tasksExtra", en.tasksExtra);
      instance.addResourceBundle("de-DE", "workItemsExtra", en.workItemsExtra);
    });
    expect(screen.getByText(text)).toBeVisible();
  });
});

describe("create form attachments across a language change", () => {
  it("keeps a staged file and uploads it after the language changes", async () => {
    const { default: NamespaceBoundary } = await import("./namespace-boundary");
    const { useCreateWorkItemAttachments } = await import(
      "@/components/work-item/use-create-work-item-attachments"
    );
    let api: ReturnType<typeof useCreateWorkItemAttachments> | undefined;
    function Form() {
      api = useCreateWorkItemAttachments("w:p");
      return <p>{api.rows.length} staged</p>;
    }
    render(
      <NamespaceBoundary>
        <Form />
      </NamespaceBoundary>,
      { wrapper: Wrapper },
    );
    await release();
    const file = new File(["a"], "a.txt");
    await act(async () => api?.stage([file]));
    expect(screen.getByText("1 staged")).toBeVisible();
    await act(async () => {
      await instance.changeLanguage("de-DE");
    });
    expect(screen.getByText("1 staged")).toBeVisible();
    uploadMock.mockResolvedValue({ id: "a-id" });
    let done: boolean | undefined;
    await act(async () => {
      done = await api?.upload("PROJ-1");
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls[0]?.[1]).toBe(file);
    expect(done).toBe(true);
    expect(api?.rows.map((row) => row.state)).toEqual(["ready"]);
  });
});

describe("create workspace dialog load failure", () => {
  it("offers a Close that dismisses the dialog, and Retry that recovers", async () => {
    const { default: Gate } = await import(
      "@/components/shared/modals/create-workspace-modal-gate"
    );
    const onClose = vi.fn();
    render(<Gate onClose={onClose} />, { wrapper: Wrapper });
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.common.error.messages.unknown,
    );
    fireEvent.click(
      screen.getByRole("button", { name: en.common.actions.close }),
    );
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: en.common.actions.retry }),
    );
    await release();
    expect(
      await screen.findByText(en.workspace.create.ownerLabel),
    ).toBeVisible();
  });
});
