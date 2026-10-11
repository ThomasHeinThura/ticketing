import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import {
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  withMfaCsrfApp,
} from "./mfa-csrf-app-fixture";

type StorageState = Awaited<ReturnType<APIRequestContext["storageState"]>>;
export type ApprovalFixtureState = {
  origin: string;
  portalOrigin: string;
  tenant: {
    key: string;
    workspaceId: string;
    projectId: string;
    transitionId: string;
    doneStateId: string;
    backlogStateId: string;
    requester: { id: string; email: string };
    approver: {
      id: string;
      email: string;
      personId: string;
      name: string;
    };
    customer: { id: string; email: string };
  };
  storageStates: {
    requester: StorageState;
    approver: StorageState;
    customer: StorageState;
  };
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const playwright = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
export const { expect, test } = playwright;

function runPrivateSeeder(
  fixture: MfaCsrfAppFixtureSetup,
  script: string,
  input: Record<string, string>,
  outputName: string,
) {
  const inputPath = resolve(fixture.fixtureDir, `${outputName}-input.json`);
  writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  const child = fixture.spawnChild(
    process.execPath,
    [
      resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      resolve(repoRoot, "apps/api/tsconfig.tests.json"),
      resolve(repoRoot, "tests/e2e/scripts", script),
      inputPath,
    ],
    {
      ...process.env,
      TASKDESK_DATABASE_URL: fixture.databaseUrl,
      TASKDESK_MIGRATION_DATABASE_URL: undefined,
    },
    outputName,
    fixture.fixtureDir,
  );
  return child.then(
    (started) =>
      new Promise<void>((resolveChild, reject) => {
        started.once("close", (code) => {
          if (code !== 0) {
            reject(
              new Error(
                `The ${outputName} fixture setup failed (exit ${String(code)}). Private logs: ${fixture.fixtureDir}`,
              ),
            );
            return;
          }
          resolveChild();
        });
      }),
  );
}

async function seedCustomerPasswordProvider(fixture: MfaCsrfAppFixtureSetup) {
  await runPrivateSeeder(
    fixture,
    "seed-approval-auth-provider.ts",
    {},
    "approval-auth-provider-seed",
  );
}

async function seedApprovalActors(
  fixture: MfaCsrfAppFixture,
): Promise<ApprovalFixtureState> {
  const statePath = resolve(fixture.fixtureDir, "approval-state.json");
  await runPrivateSeeder(
    fixture,
    "seed-approvals.ts",
    { origin: fixture.origin, stateFile: statePath },
    "approval-seed",
  );
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as ApprovalFixtureState;
  } catch {
    throw new Error(
      "The approvals fixture did not produce its private state file.",
    );
  }
}

export async function withApprovalRuntime(
  run: (
    appFixture: MfaCsrfAppFixture,
    fixture: ApprovalFixtureState,
  ) => Promise<void>,
) {
  await withMfaCsrfApp(
    async (appFixture) => run(appFixture, await seedApprovalActors(appFixture)),
    { beforeStart: seedCustomerPasswordProvider },
  );
}

export async function contextFor(state: StorageState) {
  return playwright.request.newContext({ storageState: state });
}

export async function expectStatus(response: APIResponse, status: number) {
  const body = await response.text();
  expect(response.status(), body).toBe(status);
  return body;
}

export async function postWithCsrf(
  context: APIRequestContext,
  origin: string,
  path: string,
  body: Record<string, unknown>,
) {
  const tokenResponse = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(
    tokenResponse.status(),
    "the signed-in session must receive its real CSRF token",
  ).toBe(200);
  const { token } = (await tokenResponse.json()) as { token?: string };
  expect(token).toBeTruthy();
  return context.post(new URL(path, origin).toString(), {
    data: body,
    headers: { Origin: origin, "x-taskdesk-csrf": token ?? "" },
  });
}
