import net, { type Socket } from "node:net";
import type { SmtpConfiguration } from "../../../packages/email/src/smtp-runtime";

export async function privateSmtpReceiver(
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
