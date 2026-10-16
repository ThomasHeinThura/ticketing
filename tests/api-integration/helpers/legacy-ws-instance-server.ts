import { createApp, createNodeServer } from "../../../apps/api/src/index";
import {
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../../apps/api/src/ws";

const app = createApp().app;
const node = createNodeServer(app, 0);
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await node.close();
  await shutdownWebSocketAdapter();
  process.exit(0);
}

process.on("message", (message: unknown) => {
  if (message === "stop") void stop();
});

try {
  await initializeWebSocketAdapter();
  if (!node.server.listening) {
    await new Promise<void>((resolve, reject) => {
      node.server.once("listening", resolve);
      node.server.once("error", reject);
    });
  }
  const address = node.server.address();
  if (!address || typeof address === "string") throw new Error();
  process.send?.({ type: "ready", port: address.port });
} catch {
  process.send?.({ type: "startup-error" });
  await stop();
}
