import { expect, it, vi } from "vitest";
import { profileSessionGuard } from "./profile-session-guard";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-client", () => ({ authClient: { getSession } }));
it("rejects absent and mismatched identities and bypasses the cookie cache", async () => {
  expect(() => profileSessionGuard(undefined, "s1")).toThrow(
    "session unavailable",
  );
  getSession.mockResolvedValueOnce({
    data: { user: { id: "u2" }, session: { id: "s1" } },
    error: null,
  });
  await expect(profileSessionGuard("u1", "s1")()).rejects.toThrow(
    "session changed",
  );
  expect(getSession).toHaveBeenCalledWith({
    query: { disableCookieCache: true },
  });
});
it("distinguishes session verification failure after a confirmed save", async () => {
  getSession.mockRejectedValueOnce(new Error("offline"));
  await expect(profileSessionGuard("u1", "s1")(true)).rejects.toThrow(
    "Profile saved; session could not be checked",
  );
});
