import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../src/index";

process.env.KANEO_API_URL = "https://taskdesk.bimats.com";

// Export the API contract from the router directly. The full app wrapper applies
// host-isolation middleware before `/api` routing, while this local in-process
// export has no HTTP Host header to select an application origin.
const { api } = createApp();
const response = await api.request("/openapi");

if (!response.ok) {
  throw new Error(`OpenAPI export failed with status ${response.status}`);
}

const spec = await response.json();
const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(import.meta.dirname, "../../docs/openapi.json");
await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`);
