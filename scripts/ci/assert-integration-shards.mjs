import { fileURLToPath } from "node:url";

export const INTEGRATION_SHARDS = [
  "integration-1",
  "integration-2",
  "integration-3",
  "integration-4",
];

export function assertIntegrationShards(results) {
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    throw new Error("Missing integration shard results");
  }
  const keys = Object.keys(results).sort();
  if (JSON.stringify(keys) !== JSON.stringify(INTEGRATION_SHARDS)) {
    throw new Error("Integration requires exactly all four named shards");
  }
  for (const shard of INTEGRATION_SHARDS) {
    if (results[shard]?.result !== "success") {
      throw new Error(
        `${shard} did not succeed: ${results[shard]?.result ?? "missing"}`,
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assertIntegrationShards(
      JSON.parse(process.env.INTEGRATION_SHARD_RESULTS ?? "null"),
    );
    console.log("All four integration shards passed");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
