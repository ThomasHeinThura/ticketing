import { randomUUID } from "node:crypto";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";

try {
  await db.insert(schema.instancePluginConfigTable).values({
    id: `approval-e2e-auth-${randomUUID()}`,
    pluginId: "auth.password",
    instanceKey: "approval-e2e-customer-password",
    displayName: "Approvals E2E customer password",
    enabled: true,
    config: {},
    secrets: null,
    scope: "instance",
    workspaceId: null,
    portalScope: "customer",
    configVersion: 1,
  });
} finally {
  await getDatabasePool().end();
}
