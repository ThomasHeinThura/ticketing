import http from "node:http";
import net from "node:net";

// Liveness only: fixed loopback HTTP for serving roles, fixed Unix socket for jobs.
if (process.env.TASKDESK_ROLE === "jobs") {
  const socket = net.createConnection("/tmp/taskdesk-liveness.sock");
  let response = "";
  let settled = false;
  const deadline = setTimeout(() => finish(1), 1500);

  function finish(code) {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    socket.destroy();
    process.exit(code);
  }

  socket.on("connect", () => socket.write("ping\n"));
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    response += chunk;
    if (response.length > 5) finish(1);
    else if (response === "pong\n") finish(0);
  });
  socket.on("error", () => finish(1));
  socket.on("end", () => finish(response === "pong\n" ? 0 : 1));
} else {
  // The HTTP health check remains dependency-free and uses no configured host.
  const rawPort = process.env.TASKDESK_PORT ?? "5173";
  const port = Number(rawPort);
  if (!/^\d{1,5}$/u.test(rawPort) || port < 1 || port > 65535) {
    process.exit(1);
  }

  let request;
  let settled = false;
  const deadline = setTimeout(() => finish(1), 1500);

  function finish(code) {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    request?.destroy();
    process.exit(code);
  }

  request = http.get(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/public/health/live",
      agent: false,
    },
    (response) => finish(response.statusCode === 200 ? 0 : 1),
  );
  request.on("error", () => finish(1));
}
