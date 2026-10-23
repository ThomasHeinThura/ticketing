import net, { type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv-mono", () => ({ config: vi.fn() }));

import {
  bootstrapSmtpConfiguration,
  executeSmtp,
  resolveSmtpConfiguration,
  type SmtpConfiguration,
  setRuntimeSmtpResolver,
} from "./smtp-runtime";

async function receiver(
  options: { holdAck?: boolean; stallGreeting?: boolean } = {},
) {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  let markMessage: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    markMessage = resolve;
  });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    let data = false;
    let lines: string[] = [];
    if (!options.stallGreeting) socket.write("220 synthetic.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end = buffer.indexOf("\r\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            data = false;
            messages.push(lines.join("\r\n"));
            lines = [];
            markMessage?.();
            if (!options.holdAck) socket.write("250 accepted\r\n");
          } else lines.push(line);
        } else if (/^EHLO|^HELO/u.test(line))
          socket.write("250 synthetic.test\r\n");
        else if (/^MAIL FROM:|^RCPT TO:|^RSET|^NOOP/u.test(line))
          socket.write("250 OK\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("500 unsupported\r\n");
        end = buffer.indexOf("\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Receiver address missing");
  const config: SmtpConfiguration = {
    options: {
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      ignoreTLS: true,
    },
    from: "sender@example.test",
  };
  return {
    config,
    messages,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
afterEach(() => {
  setRuntimeSmtpResolver(undefined);
  vi.unstubAllEnvs();
});

describe("real private SMTP attempts", () => {
  it("verifies without a message, then sends actual synthetic mail with stable Message-ID", async () => {
    const smtp = await receiver();
    try {
      await executeSmtp(smtp.config, null, { deadlineMs: 2000 });
      expect(smtp.messages).toHaveLength(0);
      const message = {
        to: "recipient@example.test",
        subject: "Synthetic notification",
        text: "Persisted worker proof",
        idempotencyKey: "synthetic-delivery-1", // gitleaks:allow test fixture, not a secret
      };
      await executeSmtp(smtp.config, message, { deadlineMs: 2000 });
      await executeSmtp(smtp.config, message, { deadlineMs: 2000 });
      expect(smtp.messages).toHaveLength(2);
      expect(smtp.messages[0]).toContain("Persisted worker proof");
      expect(smtp.messages[0]?.match(/Message-ID: (.+)/u)?.[1]).toBe(
        smtp.messages[1]?.match(/Message-ID: (.+)/u)?.[1],
      );
    } finally {
      await smtp.close();
    }
  });
  it("deadline terminates the actual socket and reports ambiguous DATA acceptance", async () => {
    const smtp = await receiver({ holdAck: true });
    try {
      const attempt = executeSmtp(
        smtp.config,
        {
          to: "recipient@example.test",
          subject: "Synthetic timeout",
          text: "Accepted bytes with no acknowledgement",
        },
        { deadlineMs: 150 },
      );
      const rejected = expect(attempt).rejects.toMatchObject({
        kind: "deadline",
        ambiguous: true,
      });
      await smtp.received;
      await rejected;
      expect(smtp.messages).toHaveLength(1);
    } finally {
      await smtp.close();
    }
  });
  it("external cancellation terminates a live SMTP attempt and never reports success", async () => {
    const smtp = await receiver({ holdAck: true });
    const controller = new AbortController();
    try {
      const attempt = executeSmtp(
        smtp.config,
        {
          to: "recipient@example.test",
          subject: "Synthetic cancellation",
          text: "Do not claim successful delivery",
        },
        { signal: controller.signal, deadlineMs: 2000 },
      );
      const rejected = expect(attempt).rejects.toMatchObject({
        kind: "aborted",
        ambiguous: true,
      });
      await smtp.received;
      controller.abort();
      await rejected;
    } finally {
      await smtp.close();
    }
  });
  it("rejects pre-aborted attempts and header injection before opening a socket", async () => {
    const connect = vi.fn();
    const config: SmtpConfiguration = {
      options: {},
      from: "sender@example.test",
      connect,
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeSmtp(config, null, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "aborted" });
    await expect(
      executeSmtp(config, {
        to: "recipient@example.test",
        subject: "Unsafe\r\nBcc: other@example.test",
        text: "Synthetic",
      }),
    ).rejects.toMatchObject({ kind: "rejected" });
    expect(connect).not.toHaveBeenCalled();
  });
  it("explicit runtime disable/read failure never falls back to configured environment", async () => {
    vi.stubEnv("SMTP_HOST", "bootstrap.example.test");
    vi.stubEnv("SMTP_FROM", "sender@example.test");
    setRuntimeSmtpResolver(async () => null);
    expect(await resolveSmtpConfiguration()).toBeNull();
    setRuntimeSmtpResolver(async () => {
      throw new Error("Synthetic unavailable database");
    });
    await expect(resolveSmtpConfiguration()).rejects.toThrow(
      "Synthetic unavailable database",
    );
    setRuntimeSmtpResolver(undefined);
    expect((await resolveSmtpConfiguration())?.options.host).toBe(
      "bootstrap.example.test",
    );
  });
  it.each(["main", "subpath"] as const)(
    "cold %s entry initializes inherited bootstrap without sending",
    async (entry) => {
      vi.stubEnv("SMTP_HOST", "bootstrap.example.test");
      vi.stubEnv("SMTP_FROM", "sender@example.test");
      vi.stubEnv("SMTP_PORT", "2525");
      vi.stubEnv("SMTP_SECURE", "false");
      vi.resetModules();
      const api =
        entry === "main"
          ? await import("./index")
          : await import("./smtp-runtime");
      expect(api.bootstrapSmtpConfiguration()).toMatchObject({
        from: "sender@example.test",
        options: { host: "bootstrap.example.test", port: 2525, secure: false },
      });
      expect(await api.resolveSmtpConfiguration()).toEqual(
        api.bootstrapSmtpConfiguration(),
      );
      api.setRuntimeSmtpResolver(async () => null);
      expect(await api.resolveSmtpConfiguration()).toBeNull();
      api.setRuntimeSmtpResolver(async () => {
        throw new Error("Synthetic runtime read failure");
      });
      await expect(api.resolveSmtpConfiguration()).rejects.toThrow(
        "Synthetic runtime read failure",
      );
      api.setRuntimeSmtpResolver(undefined);
    },
  );
  it("an incomplete inherited bootstrap remains unavailable", () => {
    vi.stubEnv("SMTP_HOST", "bootstrap.example.test");
    vi.stubEnv("SMTP_FROM", "");
    expect(bootstrapSmtpConfiguration()).toBeNull();
  });
});
