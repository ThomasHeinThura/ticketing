import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeSmtpConfiguration } from "../../../apps/api/src/notification-provider/runtime";
import type { SmtpConfig } from "../../../apps/api/src/notification-provider/schema";
import { openSmtpSocket } from "../../../packages/email/src/smtp-execution";

const ordinaryConfig: SmtpConfig = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  requireTLS: true,
  username: null,
  fromAddress: "taskdesk@example.test",
  replyTo: null,
};

const captureConfig: SmtpConfig = {
  ...ordinaryConfig,
  host: "mailpit",
  port: 1025,
  secure: false,
  requireTLS: false,
  captureToMailpit: true,
};

function allowLocalMailpitCapture() {
  vi.stubEnv("TASKDESK_LOCAL_MAILPIT_CAPTURE", "true");
  vi.stubEnv("TASKDESK_AGENT_URL", "https://ticketing.localhost");
  vi.stubEnv("TASKDESK_PORTAL_URL", "https://portal.localhost");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runtimeSmtpConfiguration local Mailpit capture", () => {
  it("uses only the fixed Compose endpoint without DNS, authentication, or TLS", async () => {
    allowLocalMailpitCapture();
    const resolve = vi.fn(async () => [
      { address: "127.0.0.1", family: 4 as const },
    ]);
    const connect = vi.fn(
      async (
        _input: Parameters<typeof openSmtpSocket>[0],
        _signal: AbortSignal,
      ) => {
        throw new Error("captured fixed-endpoint attempt");
      },
    );

    const selected = runtimeSmtpConfiguration(captureConfig, null, {
      resolve,
      connect,
    });

    expect(selected.options).toMatchObject({
      host: "mailpit",
      port: 1025,
      secure: false,
      requireTLS: false,
      ignoreTLS: true,
    });
    expect(selected.options.auth).toBeUndefined();
    const signal = new AbortController().signal;
    await expect(selected.connect?.(signal)).rejects.toThrow(
      "captured fixed-endpoint attempt",
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith(
      { host: "mailpit", port: 1025, secure: false },
      signal,
    );
  });

  it("fails closed when the local bootstrap capability is absent", () => {
    const connect = vi.fn(
      async (
        _input: Parameters<typeof openSmtpSocket>[0],
        _signal: AbortSignal,
      ) => {
        throw new Error("must not connect");
      },
    );
    expect(() =>
      runtimeSmtpConfiguration(captureConfig, null, {
        resolve: async () => [],
        connect,
      }),
    ).toThrow("SMTP configuration unavailable");
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses a persisted capture profile that names any other endpoint", () => {
    allowLocalMailpitCapture();
    expect(() =>
      runtimeSmtpConfiguration({ ...captureConfig, host: "127.0.0.1" }, null, {
        resolve: async () => [],
        connect: openSmtpSocket,
      }),
    ).toThrow("SMTP configuration unavailable");
    expect(() => runtimeSmtpConfiguration(captureConfig, "secret")).toThrow(
      "SMTP configuration unavailable",
    );
  });

  it("keeps ordinary SMTP on the existing public DNS-pinned path", async () => {
    const resolve = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 as const },
    ]);
    const connect = vi.fn(
      async (
        _input: Parameters<typeof openSmtpSocket>[0],
        _signal: AbortSignal,
      ) => {
        throw new Error("ordinary fixed-IP attempt");
      },
    );
    const selected = runtimeSmtpConfiguration(ordinaryConfig, null, {
      resolve,
      connect,
    });
    const signal = new AbortController().signal;
    await expect(selected.connect?.(signal)).rejects.toThrow(
      "ordinary fixed-IP attempt",
    );
    expect(resolve).toHaveBeenCalledWith("smtp.example.test");
    expect(connect).toHaveBeenCalledWith(
      {
        host: "8.8.8.8",
        port: 587,
        secure: false,
        servername: "smtp.example.test",
      },
      signal,
    );
  });

  it("continues to refuse private DNS results for ordinary SMTP", async () => {
    const connect = vi.fn(
      async (
        _input: Parameters<typeof openSmtpSocket>[0],
        _signal: AbortSignal,
      ) => {
        throw new Error("must not connect");
      },
    );
    const selected = runtimeSmtpConfiguration(ordinaryConfig, null, {
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      connect,
    });

    await expect(
      selected.connect?.(new AbortController().signal),
    ).rejects.toThrow("SMTP destination unavailable");
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses capture when the capability is set on nonlocal origins", () => {
    vi.stubEnv("TASKDESK_LOCAL_MAILPIT_CAPTURE", "true");
    vi.stubEnv("TASKDESK_AGENT_URL", "https://ticketing.example.com");
    vi.stubEnv("TASKDESK_PORTAL_URL", "https://portal.localhost");
    expect(() => runtimeSmtpConfiguration(captureConfig, null)).toThrow(
      "SMTP configuration unavailable",
    );
  });

  it.each([
    ["credentialed origin", "https://admin@ticketing.localhost"],
    ["nested path", "https://ticketing.localhost/admin"],
    ["query string", "https://ticketing.localhost/?tenant=x"],
  ])("refuses a noncanonical local agent origin (%s)", (_name, agentUrl) => {
    vi.stubEnv("TASKDESK_LOCAL_MAILPIT_CAPTURE", "true");
    vi.stubEnv("TASKDESK_AGENT_URL", agentUrl);
    vi.stubEnv("TASKDESK_PORTAL_URL", "https://portal.localhost");
    expect(() => runtimeSmtpConfiguration(captureConfig, null)).toThrow(
      "SMTP configuration unavailable",
    );
  });
});
