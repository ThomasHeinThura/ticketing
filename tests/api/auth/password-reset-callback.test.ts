import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eligible: vi.fn(),
  send: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("../../../apps/api/src/auth/password-reset", async (load) => ({
  ...(await load<object>()),
  canResetPassword: mocks.eligible,
  consumeResetAddressLimit: mocks.limit,
}));
vi.mock("../../../apps/api/src/auth/repository", async (load) => ({
  ...(await load<object>()),
  getAuthUserLocale: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../packages/email/dist/index.js", async (load) => ({
  ...(await load<object>()),
  sendPasswordResetEmail: mocks.send,
}));

import { auth, portalAuth } from "../../../apps/api/src/auth";

const user = {
  id: "user",
  name: "Name",
  email: "person@example.test",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const invoke = (instance: typeof auth) =>
  instance.options.emailAndPassword?.sendResetPassword?.({
    user,
    token: "token",
    url: "ignored",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eligible.mockResolvedValue(true);
  mocks.send.mockResolvedValue(undefined);
  mocks.limit.mockResolvedValue(true);
});
describe("reset mail callback", () => {
  it.each([
    ["agent", auth, "http://localhost:5173/auth/reset-password"],
    ["customer", portalAuth, "http://portal.localhost:5174/reset-password"],
  ] as const)(
    "binds the %s link to its host",
    async (_portal, instance, expected) => {
      await invoke(instance);
      await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
      const link = new URL(mocks.send.mock.calls[0]?.[2].resetLink);
      expect(`${link.origin}${link.pathname}`).toBe(expected);
      expect(link.search).toBe("");
      expect(new URLSearchParams(link.hash.slice(1)).get("token")).toMatch(
        /^token\./,
      );
    },
  );
  it("does not build the link from a forged request Host", async () => {
    const callback = auth.options.emailAndPassword?.sendResetPassword;
    if (!callback) throw new Error("Missing callback");
    await Reflect.apply(callback, undefined, [
      { user, token: "token", url: "http://attacker.example/reset" },
      new Request("http://attacker.example", {
        headers: { host: "attacker.example" },
      }),
    ]);
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    const link = new URL(mocks.send.mock.calls[0]?.[2].resetLink);
    expect(link.origin).toBe("http://localhost:5173");
  });
  it("refuses the library callback that falls back to plaintext lookup", async () => {
    const response = await auth.handler(
      new Request(
        "http://localhost:5173/api/auth/reset-password/raw?callbackURL=%2Fauth%2Freset-password",
      ),
    );
    expect(response.status).toBe(404);
  });
  it("does not send to an ineligible account", async () => {
    mocks.eligible.mockResolvedValue(false);
    await invoke(auth);
    await vi.waitFor(() => expect(mocks.eligible).toHaveBeenCalledOnce());
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("swallows delivery failures", async () => {
    mocks.send.mockRejectedValue(new Error("mail failed"));
    await expect(invoke(auth)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
  });
});
