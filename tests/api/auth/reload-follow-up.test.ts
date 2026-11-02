import { describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  pluginId: string;
  enabled: boolean;
  scope: string;
  portalScope: string | null;
  configVersion: number;
};

const state = vi.hoisted(() => ({
  reads: 0,
  next: async (): Promise<Row[]> => [],
}));

vi.mock("../../../apps/api/src/auth/repository", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/api/src/auth/repository")
  >()),
  getStoredAuthPluginConfigRows: () => {
    state.reads += 1;
    return state.next();
  },
  getIdentityConnectionConfigVersions: async () => [],
}));

import {
  customerLocalAuthMethods,
  reloadAuthConfiguration,
} from "../../../apps/api/src/auth";

const customerPassword: Row = {
  id: "customer-password",
  pluginId: "auth.password",
  enabled: true,
  scope: "instance",
  portalScope: "customer",
  configVersion: 1,
};

describe("auth configuration reload while another reload is in flight", () => {
  it("runs one follow-up reload so a change committed during the first read is applied", async () => {
    // The first reload reads the rows before the change commits ...
    let releaseFirstRead: (rows: Row[]) => void = () => {};
    state.next = () =>
      new Promise<Row[]>((resolve) => {
        releaseFirstRead = resolve;
      });
    const first = reloadAuthConfiguration();
    await vi.waitFor(() => expect(state.reads).toBe(1));

    // ... the writer commits and asks for a reload while the first is still reading.
    state.next = async () => [customerPassword];
    const second = reloadAuthConfiguration();
    const third = reloadAuthConfiguration();

    releaseFirstRead([]);
    await first;
    await expect(second).resolves.toBe(true);
    await third;

    // One shared follow-up read, and the swap reflects the committed row.
    expect(state.reads).toBe(2);
    expect(customerLocalAuthMethods()).toEqual({
      password: true,
      magicLink: false,
      emailOtp: false,
    });
  });

  it("does not reload again when nothing is in flight and nothing changed", async () => {
    const before = state.reads;
    await expect(reloadAuthConfiguration()).resolves.toBe(false);
    expect(state.reads).toBe(before + 1);
  });
});
