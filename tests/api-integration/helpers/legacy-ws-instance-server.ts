import type { AddressInfo, Server } from "node:net";

type OwnedNodeServer = {
  server: Server;
  close: () => Promise<unknown>;
};

const startedAt = performance.now();
let phase = "helper-entry";
let node: OwnedNodeServer | undefined;
let shutdownAdapter: (() => Promise<void>) | undefined;
let stopping = false;
let stopped: Promise<void> | undefined;

function reportPhase(name: string) {
  phase = name;
  process.send?.({
    type: "phase",
    name,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}

async function stop() {
  if (stopped) return stopped;
  stopping = true;
  stopped = (async () => {
    if (node) await node.close();
    if (shutdownAdapter) await shutdownAdapter();
    process.disconnect?.();
  })();
  return stopped;
}

process.on("message", (message: unknown) => {
  if (message === "stop") void stop();
});

reportPhase("helper-entered");

try {
  reportPhase("api-module-import-started");
  const { createApp, createNodeServer } = await import(
    "../../../apps/api/src/index"
  );
  if (stopping) process.exit(0);
  reportPhase("api-module-imported");

  const app = createApp().app;
  reportPhase("app-created");

  node = createNodeServer(app, 0, { hostname: "127.0.0.1" });
  reportPhase("server-created");

  reportPhase("websocket-module-import-started");
  const websocket = await import("../../../apps/api/src/ws");
  shutdownAdapter = websocket.shutdownWebSocketAdapter;
  if (stopping) {
    await stop();
    process.exit(0);
  }
  reportPhase("websocket-module-imported");

  reportPhase("websocket-adapter-initialization-started");
  await websocket.initializeWebSocketAdapter();
  reportPhase("websocket-adapter-ready");

  if (!node.server.listening) {
    reportPhase("server-listening-wait-started");
    await new Promise<void>((resolve, reject) => {
      node?.server.once("listening", resolve);
      node?.server.once("error", reject);
    });
  }
  reportPhase("server-listening");

  const address = node.server.address();
  if (
    !address ||
    typeof address === "string" ||
    address.address !== "127.0.0.1"
  ) {
    throw new Error("Unexpected test server bind address");
  }
  process.send?.({ type: "ready", port: (address as AddressInfo).port });
} catch {
  process.send?.({ type: "startup-error", phase });
  try {
    await stop();
  } finally {
    process.exitCode = 1;
  }
}
