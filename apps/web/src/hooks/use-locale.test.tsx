import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useLocale } from "./use-locale";

const mock = vi.hoisted(() => ({
  update: vi.fn(),
  change: vi.fn(),
  audited: vi.fn(),
  identity: { id: "u1", session: "s1" },
  missingSession: false,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    updateUser: mock.update,
    getSession: async () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
      error: null,
    }),
    useSession: () => ({
      data: mock.missingSession
        ? undefined
        : {
            user: { id: mock.identity.id },
            session: { id: mock.identity.session },
          },
    }),
  },
}));
vi.mock("@/lib/i18n", () => ({
  getBrowserLocale: () => "en-US",
  resolveLocale: (value: string) => value,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: "en-US", changeLanguage: mock.change },
  }),
}));

function mount() {
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _context, mutation) =>
        mock.audited(
          mutation.meta?.audits?.targets(variables as never, data as never),
        ),
    }),
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { invalidate, hook: renderHook(() => useLocale(), { wrapper }) };
}

it("audits a committed locale save even if the session then changes, and applies nothing", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.change.mockClear();
  mock.audited.mockClear();
  const previousLanguage = document.documentElement.lang;
  let finish!: (value: unknown) => void;
  mock.update.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { invalidate, hook } = mount();
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.setLocale("en-US");
  });
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalled());
  mock.identity = { id: "u2", session: "s2" };
  hook.rerender();
  await act(async () => {
    finish({ error: null });
    await expect(pending).rejects.toThrow("session changed");
  });
  expect(mock.audited).toHaveBeenCalledWith([
    { kind: "self", audience: "staff", section: "profile" },
  ]);
  expect(invalidate).not.toHaveBeenCalled();
  expect(mock.change).not.toHaveBeenCalled();
  expect(document.documentElement.lang).toBe(previousLanguage);
});

it("does not audit or invalidate after a failed locale save", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.audited.mockClear();
  mock.update.mockResolvedValueOnce({ error: { message: "denied" } });
  const { invalidate, hook } = mount();
  await expect(hook.result.current.setLocale("en-US")).rejects.toThrow(
    "denied",
  );
  expect(invalidate).not.toHaveBeenCalled();
  expect(mock.audited).not.toHaveBeenCalled();
});

it("audits the profile, invalidates the session and changes language on success", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.audited.mockClear();
  mock.change.mockClear();
  mock.update.mockResolvedValueOnce({ error: null });
  const { invalidate, hook } = mount();
  await act(async () => {
    await hook.result.current.setLocale("en-US");
  });
  expect(mock.audited).toHaveBeenCalledWith([
    { kind: "self", audience: "staff", section: "profile" },
  ]);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["session"] });
  expect(mock.change).toHaveBeenCalledWith("en-US");
});

it("renders without a session and rejects only when saving", async () => {
  mock.missingSession = true;
  try {
    const { hook } = mount();
    expect(hook.result.current.locale).toBe("en-US");
    await expect(hook.result.current.setLocale("en-US")).rejects.toThrow(
      "session unavailable",
    );
  } finally {
    mock.missingSession = false;
  }
});
