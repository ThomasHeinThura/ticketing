import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../src/index";

process.env.KANEO_API_URL = "https://taskdesk.bimats.com";

const { app } = createApp();
const openApiOrigin = process.env.TASKDESK_AGENT_URL || "http://localhost:5173";
// Hono's in-process fetch adapter does not consistently preserve URL authority
// as a Host header. The production app routes by Host, so make the configured
// agent authority explicit for this local export request.
const response = await app.request("/api/openapi", {
  headers: { host: new URL(openApiOrigin).host },
});

if (!response.ok) {
  throw new Error(`OpenAPI export failed with status ${response.status}`);
}

const spec = await response.json();
const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "../../docs/openapi.json");
await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`);
