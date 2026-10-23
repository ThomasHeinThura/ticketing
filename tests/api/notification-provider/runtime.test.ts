import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ lookup: vi.fn(), open: vi.fn() }));

import { runtimeSmtpConfiguration } from "../../../apps/api/src/notification-provider/runtime";

const config = {
  host: "smtp.example.test",
  port: 465,
  secure: true,
  requireTLS: true,
  username: null,
  fromAddress: "sender@example.test",
  replyTo: null,
};
beforeEach(() => {
  seams.lookup.mockReset();
  seams.open.mockReset();
  seams.open.mockResolvedValue({ socket: {}, secured: true });
});
afterEach(() => vi.restoreAllMocks());
describe("SMTP public-destination pinning", () => {
  it("pins the checked IP while preserving TLS server-name validation", async () => {
    seams.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const smtp = runtimeSmtpConfiguration(config, null, {
      resolve: seams.lookup,
      connect: seams.open,
    });
    expect(smtp.options.tls).toMatchObject({
      servername: config.host,
      rejectUnauthorized: true,
    });
    const signal = new AbortController().signal;
    await smtp.connect?.(signal);
    expect(seams.open).toHaveBeenCalledWith(
      { host: "8.8.8.8", port: 465, secure: true, servername: config.host },
      signal,
    );
  });
  it("rejects metadata/private literals without DNS or a connection", async () => {
    for (const host of [
      "127.0.0.1",
      "169.254.169.254",
      "10.1.2.3",
      "::1",
      "fd00:ec2::254",
    ]) {
      await expect(
        runtimeSmtpConfiguration({ ...config, host }, null, {
          resolve: seams.lookup,
          connect: seams.open,
        }).connect?.(new AbortController().signal),
      ).rejects.toThrow();
    }
    expect(seams.lookup).not.toHaveBeenCalled();
    expect(seams.open).not.toHaveBeenCalled();
  });
  it("rejects mixed public/private DNS answers and late DNS completion after cancellation", async () => {
    seams.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      runtimeSmtpConfiguration(config, null, {
        resolve: seams.lookup,
        connect: seams.open,
      }).connect?.(new AbortController().signal),
    ).rejects.toThrow();
    let release: ((value: unknown) => void) | undefined;
    seams.lookup.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const controller = new AbortController();
    const pending = runtimeSmtpConfiguration(config, null, {
      resolve: seams.lookup,
      connect: seams.open,
    }).connect?.(controller.signal);
    controller.abort();
    release?.([{ address: "8.8.8.8", family: 4 }]);
    await expect(pending).rejects.toThrow();
    expect(seams.open).not.toHaveBeenCalled();
  });
});
