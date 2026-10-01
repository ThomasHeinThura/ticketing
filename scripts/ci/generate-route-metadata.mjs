#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeRouteMetadata } from "./lib/route-metadata.mjs";

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const destination = await writeRouteMetadata();
  console.log(`Generated ${destination}`);
}
