import { startAuthConfigRuntime } from "../../../apps/api/src/auth";
import { createApp, createNodeServer } from "../../../apps/api/src/index";
import {
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws";

const node = createNodeServer(
  createApp().app,
  Number(process.env.TASKDESK_PORT) || 0,
  { hostname: "127.0.0.1" },
);
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await node.close();
  } finally {
    await shutdownWebSocketAdapter();
    process.exit(0);
  }
}

process.on("message", (message: unknown) => {
  if (message === "stop") void stop();
});

try {
  await startAuthConfigRuntime();
  await initializeWebSocketAdapter();
  if (!node.server.listening) {
    await new Promise<void>((resolve, reject) => {
      node.server.once("listening", resolve);
      node.server.once("error", reject);
    });
  }
  const address = node.server.address();
  if (
    !address ||
    typeof address === "string" ||
    address.address !== "127.0.0.1"
  ) {
    throw new Error();
  }
  process.send?.({ type: "ready", port: address.port });
} catch {
  process.send?.({ type: "startup-error" });
  await stop();
}
