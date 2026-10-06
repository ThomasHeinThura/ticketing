import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getConfiguredAgentOrigin } from "../src/auth";
import { createApp } from "../src/index";

process.env.KANEO_API_URL = "https://taskdesk.bimats.com";

const { app } = createApp();
const agentOrigin = new URL(getConfiguredAgentOrigin());
const response = await app.request(
  new URL("/api/openapi", agentOrigin).toString(),
  { headers: { host: agentOrigin.host } },
);

if (!response.ok) {
  throw new Error(`OpenAPI export failed with status ${response.status}`);
}

const spec = await response.json();
const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "../../docs/openapi.json");
await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`);
