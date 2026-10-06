import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { operationsOf } from "./openapi-operations.mjs";

test("OpenAPI operation count ignores path-item metadata", () => {
  const operations = operationsOf({
    paths: {
      "/scim/v2/Users": {
        servers: [{ url: "/" }],
        get: {},
        post: {},
      },
    },
  });

  assert.deepEqual([...operations].sort(), [
    "GET /scim/v2/Users",
    "POST /scim/v2/Users",
  ]);
});

test("SCIM path servers resolve at the same-origin root", async () => {
  const contract = JSON.parse(
    await readFile(
      new URL("../../../tests/api-contract/openapi.json", import.meta.url),
      "utf8",
    ),
  );
  const origin = "https://taskdesk.example.test";
  const scimPaths = Object.entries(contract.paths).filter(([path]) =>
    path.startsWith("/scim/v2/"),
  );

  assert.ok(scimPaths.length > 0);
  for (const [path, pathItem] of scimPaths) {
    assert.equal(pathItem.servers?.[0]?.url, "/", `${path} server`);
    const resolvedPath = decodeURIComponent(
      new URL(path, new URL(pathItem.servers[0].url, origin)).pathname,
    );
    assert.equal(resolvedPath, path);
    assert.ok(!resolvedPath.startsWith("/api/"));
  }
});
