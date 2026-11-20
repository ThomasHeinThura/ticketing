import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach as cleanupOffline,
  expect,
  it,
  beforeEach as setupOffline,
  vi,
} from "vitest";
import { usePatchUserSettings } from "./use-patch-user-settings";

const mock = vi.hoisted(() => ({
  patch: vi.fn(),
  getSession: vi.fn(),
  audited: vi.fn(),
  identity: { id: "u1", session: "s1" },
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: mock.identity.id } }),
}));
vi.mock("@/fetchers/user-settings/user-settings", () => ({
  patchUserSettings: mock.patch,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
    }),
    getSession: mock.getSession,
  },
}));
function setup() {
  mock.getSession.mockImplementation(async () => ({
    data: {
      user: { id: mock.identity.id },
      session: { id: mock.identity.session },
    },
    error: null,
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _context, mutation) =>
        mock.audited(
          mutation.meta?.audits?.targets(variables as never, data as never),
        ),
    }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    hook: renderHook(() => usePatchUserSettings(), { wrapper }),
  };
}
it("declares the preferences History target after a successful write and not on failure", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.audited.mockReset();
  mock.patch
    .mockReset()
    .mockResolvedValueOnce({ settings: {} })
    .mockRejectedValueOnce(new Error("failed"));
  const { hook } = setup();
  await act(async () => {
    await hook.result.current.mutateAsync({ density: "compact" });
  });
  expect(mock.audited).toHaveBeenCalledOnce();
  expect(mock.audited).toHaveBeenCalledWith([
    { kind: "self", audience: "staff", section: "preferences" },
  ]);
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ density: "comfortable" }),
    ).rejects.toThrow("failed");
  });
  expect(mock.audited).toHaveBeenCalledOnce();
});

setupOffline(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline test")));
});
it("does not write if the captured session changed before sending", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.patch.mockReset();
  const { hook } = setup();
  mock.getSession.mockResolvedValueOnce({
    data: { user: { id: "u2" }, session: { id: "s2" } },
    error: null,
  });
  mock.audited.mockReset();
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ density: "compact" }),
    ).rejects.toThrow("session changed");
  });
  expect(mock.patch).not.toHaveBeenCalled();
  expect(mock.audited).not.toHaveBeenCalled();
});

cleanupOffline(() => vi.unstubAllGlobals());
