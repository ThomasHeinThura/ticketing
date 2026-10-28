/**
 * Import reconciliation routes (P6). Instance-administrator work declared in `./policy.ts`.
 *
 *   GET  /api/imports/{id}/reconciliation   the persisted snapshot, or `reconciliation: null`
 *   POST /api/imports/{id}/reconciliation   recompute and replace the snapshot (Idempotency-Key)
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireCurrentInstanceAdmin } from "../../instance/require-instance-admin";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { importRunIdParams } from "../schema";
import { getReconciliation, recomputeReconciliation } from "./service";

const error = z.object({ message: z.string() });
const loose = z.record(z.string(), z.unknown());
const common = {
  403: jsonResponse("Forbidden", error),
  404: jsonResponse("Import run not found", error),
};

function requireIdempotencyKey(c: Context) {
  const key = c.req.header("Idempotency-Key");
  if (
    !key ||
    key.length > 200 ||
    [...key].some((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    throw new HTTPException(400, { message: "Idempotency-Key is required" });
}

const getRoute = createRoute({
  method: "get",
  path: "/imports/{id}/reconciliation",
  operationId: "getImportReconciliation",
  tags: ["Imports"],
  summary: "Get the persisted reconciliation snapshot for an import run",
  request: { params: importRunIdParams },
  responses: { 200: jsonResponse("Reconciliation", loose), ...common },
});
const postRoute = createRoute({
  method: "post",
  path: "/imports/{id}/reconciliation",
  operationId: "recomputeImportReconciliation",
  tags: ["Imports"],
  summary: "Recompute the reconciliation snapshot for an import run",
  request: { params: importRunIdParams },
  responses: { 200: jsonResponse("Reconciliation", loose), ...common },
});

export function createImportReconciliationRouter() {
  return apiRouter()
    .openapi(getRoute, async (c) => {
      await requireCurrentInstanceAdmin(
        c,
        "GET",
        "/api/imports/{id}/reconciliation",
      );
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(await getReconciliation(c, c.req.valid("param").id), 200);
    })
    .openapi(postRoute, async (c) => {
      await requireCurrentInstanceAdmin(
        c,
        "POST",
        "/api/imports/{id}/reconciliation",
      );
      requireIdempotencyKey(c);
      setShadowLegacyAuthorization(c, "allowed");
      return c.json(
        await recomputeReconciliation(c, c.req.valid("param").id),
        200,
      );
    });
}

export default createImportReconciliationRouter;
