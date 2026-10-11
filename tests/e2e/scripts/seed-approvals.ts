import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import db, { getDatabasePool, schema } from "../../../apps/api/src/database";
import {
  addApprovalE2ECustomer,
  seedApprovalTenant,
} from "../helpers/approval-database-fixture";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(repoRoot, "apps/api/package.json"));
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const { request } = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const databaseUrl = process.env.TASKDESK_DATABASE_URL;
const inputPath = process.argv[2];
if (!databaseUrl || !inputPath) {
  throw new Error("Approval E2E fixture inputs are missing.");
}
const seedInput = JSON.parse(await readFile(inputPath, "utf8")) as {
  origin: string;
  stateFile: string;
};
const { origin, stateFile } = seedInput;

type APIRequestContext = import("@playwright/test").APIRequestContext;
type Actor = { id: string; email: string; name: string };

async function addCredentialAccount(actor: Actor, password: string) {
  await db.insert(schema.accountTable).values({
    id: `approval-e2e-${randomUUID()}`,
    accountId: actor.id,
    providerId: "credential",
    userId: actor.id,
    password: await bcrypt.hash(password, 4),
  });
}

async function signIn(
  email: string,
  password: string,
  actorOrigin: string,
): Promise<APIRequestContext> {
  const context = await request.newContext({
    extraHTTPHeaders: { origin: actorOrigin },
  });
  const response = await context.post(
    new URL("/api/auth/sign-in/email", actorOrigin).toString(),
    { data: { email, password } },
  );
  if (response.status() !== 200) {
    await context.dispose();
    throw new Error("BetterAuth rejected a seeded approvals identity.");
  }
  const session = await context.get(
    new URL("/api/auth/get-session", actorOrigin).toString(),
  );
  if (session.status() !== 200 || !(await session.json())) {
    await context.dispose();
    throw new Error("BetterAuth did not establish the approvals session.");
  }
  return context;
}

async function csrfPost(
  context: APIRequestContext,
  actorOrigin: string,
  path: string,
  body: Record<string, unknown>,
) {
  const tokenResponse = await context.get(
    new URL("/api/me/csrf-token", actorOrigin).toString(),
  );
  if (tokenResponse.status() !== 200) {
    throw new Error("The real session could not obtain its CSRF token.");
  }
  const { token } = (await tokenResponse.json()) as { token?: string };
  if (!token) throw new Error("The CSRF endpoint returned no token.");
  return context.post(new URL(path, actorOrigin).toString(), {
    data: body,
    headers: { "x-taskdesk-csrf": token },
  });
}

const requesterPassword = randomUUID();
const approverPassword = randomUUID();
const customerPassword = randomUUID();
const requesterOrigin = origin;
const portalOrigin = new URL(origin);
portalOrigin.hostname = "portal.localhost";

let requesterContext: APIRequestContext | undefined;
let approverContext: APIRequestContext | undefined;
let customerContext: APIRequestContext | undefined;
try {
  const tenant = await seedApprovalTenant(
    async ({ projectId, typeId, title, requester: actor }) => {
      await addCredentialAccount(actor.user, requesterPassword);
      const context = await signIn(
        actor.user.email,
        requesterPassword,
        requesterOrigin,
      );
      requesterContext = context;
      const response = await csrfPost(
        context,
        requesterOrigin,
        `/api/projects/${encodeURIComponent(projectId)}/work-items`,
        { typeId, title },
      );
      return { ok: response.ok(), json: () => response.json() };
    },
  );

  await addCredentialAccount(tenant.approver.user, approverPassword);
  approverContext = await signIn(
    tenant.approver.user.email,
    approverPassword,
    requesterOrigin,
  );

  const customer = await addApprovalE2ECustomer(tenant.workspaceId);
  await addCredentialAccount(customer.user, customerPassword);
  customerContext = await signIn(
    customer.user.email,
    customerPassword,
    portalOrigin.toString(),
  );

  if (!requesterContext || !approverContext || !customerContext) {
    throw new Error("An approvals actor did not receive a real session.");
  }

  const visible = await requesterContext.get(
    new URL(
      `/api/work-items/${encodeURIComponent(tenant.key)}/approvals`,
      origin,
    ).toString(),
  );
  if (visible.status() !== 200) {
    throw new Error("The requester could not read the approvals resource.");
  }

  await writeFile(
    stateFile,
    JSON.stringify({
      origin,
      portalOrigin: portalOrigin.toString(),
      tenant: {
        key: tenant.key,
        workspaceId: tenant.workspaceId,
        projectId: tenant.project.id,
        transitionId: tenant.transition.id,
        doneStateId: tenant.done.id,
        backlogStateId: tenant.backlog.id,
        requester: {
          id: tenant.requester.user.id,
          email: tenant.requester.user.email,
        },
        approver: {
          id: tenant.approver.user.id,
          email: tenant.approver.user.email,
          personId: tenant.approverPerson.id,
          name: tenant.approver.user.name,
        },
        customer: { id: customer.user.id, email: customer.user.email },
      },
      storageStates: {
        requester: await requesterContext.storageState(),
        approver: await approverContext.storageState(),
        customer: await customerContext.storageState(),
      },
    }),
    { mode: 0o600 },
  );
} finally {
  try {
    await Promise.all(
      [requesterContext, approverContext, customerContext]
        .filter(
          (context): context is APIRequestContext => context !== undefined,
        )
        .map((context) => context.dispose()),
    );
  } finally {
    await getDatabasePool().end();
  }
}
