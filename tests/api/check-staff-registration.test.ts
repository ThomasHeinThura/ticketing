import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enabled: false, find: vi.fn() }));
vi.mock("../../apps/api/src/auth/staff-registration", () => ({
  staffSelfRegistrationEnabled: () => mocks.enabled,
}));
vi.mock("../../apps/api/src/utils/registration.repository", () => ({
  findPendingInvitation: mocks.find,
  findInvitationWithNames: vi.fn(),
  listPendingInvitationsForEmail: vi.fn(),
}));

import { checkRegistrationAllowed } from "../../apps/api/src/utils/check-registration-allowed";

beforeEach(() => {
  mocks.enabled = false;
  mocks.find.mockReset();
});

describe("staff invitation registration", () => {
  it("allows open registration only when enabled", async () => {
    expect(
      (await checkRegistrationAllowed("person@example.test")).allowed,
    ).toBe(false);
    mocks.enabled = true;
    expect(
      (await checkRegistrationAllowed("person@example.test")).allowed,
    ).toBe(true);
  });
  it("requires a matching email even with an invitation id", async () => {
    expect(
      (await checkRegistrationAllowed(undefined, "invitation")).allowed,
    ).toBe(false);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("accepts only the live invitation returned for the given email and id", async () => {
    mocks.find
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "invitation" });
    expect(
      (await checkRegistrationAllowed("person@example.test", "invitation"))
        .allowed,
    ).toBe(false);
    expect(
      (await checkRegistrationAllowed("person@example.test", "invitation"))
        .allowed,
    ).toBe(true);
    expect(mocks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "person@example.test",
        invitationId: "invitation",
      }),
    );
  });
  it("permits email matching only on trusted sign-in paths", async () => {
    mocks.find.mockResolvedValue({ id: "invitation" });
    expect(
      (await checkRegistrationAllowed("person@example.test")).allowed,
    ).toBe(false);
    expect(
      (
        await checkRegistrationAllowed("person@example.test", undefined, {
          allowInvitationByEmail: true,
        })
      ).allowed,
    ).toBe(true);
  });
});
