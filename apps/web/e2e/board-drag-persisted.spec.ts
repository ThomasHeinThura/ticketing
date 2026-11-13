import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "../../../tests/e2e/helpers/project-key";
import { enrollFirstAdmin } from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type State = { id: string; name: string; stateTemplateId: string };
type Item = { id: string; key: string; stateId: string };
type Transition = {
  fromStateTemplateId: string | null;
  toStateTemplateId: string;
  [key: string]: unknown;
};

async function requestJson<T>(
  page: Page,
  path: string,
  options?: { method?: "POST"; data?: unknown },
): Promise<T> {
  const result = await page.evaluate(
    async ({ path: url, options: input }) => {
      const issuer = await fetch("/api/me/csrf-token", {
        credentials: "same-origin",
      });
      if (!issuer.ok) return { status: issuer.status, body: null };
      const { token } = (await issuer.json()) as { token: string };
      const response = await fetch(url, {
        method: input?.method ?? "GET",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-csrf": token,
        },
        ...(input?.data === undefined
          ? {}
          : { body: JSON.stringify(input.data) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, options },
  );
  expect(result.status, `Unexpected HTTP status for ${path}`).toBe(200);
  return result.body as T;
}

async function dragCard(page: Page, source: Locator, destination: Locator) {
  await source.scrollIntoViewIfNeeded();
  await destination.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await destination.boundingBox();
  if (!from || !to) throw new Error("Board cards are not visible for dragging");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 12,
    from.y + from.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 4, {
    steps: 12,
  });
  await expect(
    page
      .locator('[aria-live="assertive"]')
      .filter({ hasText: "Moving card is over Destination last." }),
  ).toHaveCount(1);
  await page.mouse.up();
}

test("board drop stays in place through a real write and a refused move returns focus", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const containers: string[] = [];
  try {
    await withMfaCsrfApp(
      async ({ origin, email, password, setupUrl }) => {
        const context = await browser.newContext({
          viewport: { width: 1920, height: 1000 },
          locale: "en-GB",
          timezoneId: "UTC",
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          await navigateToSetup(page, setupUrl);
          await page.getByLabel("Full name").fill("Board Journey Admin");
          await page.getByLabel("Email").fill(email);
          await page
            .locator('input[autocomplete="new-password"]')
            .fill(password);
          await page.getByRole("button", { name: "Create account" }).click();
          // The first administrator must enrol a second factor before onboarding.
          await enrollFirstAdmin(page, origin, password);
          await page
            .getByLabel("Workspace name")
            .fill("Board Journey Workspace");
          await page.getByRole("button", { name: "Create workspace" }).click();
          await expect(page).toHaveURL(/\/dashboard\/workspace\//);
          const workspaceId = new URL(page.url()).pathname.match(
            /\/dashboard\/workspace\/([^/]+)/,
          )?.[1];
          if (!workspaceId) throw new Error("Workspace identifier missing");
          const slug = uniqueProjectKey(8);
          const project = await requestJson<{ id: string }>(
            page,
            "/api/project",
            {
              method: "POST",
              data: {
                name: "Board Journey",
                icon: "Folder",
                slug,
                workspaceId,
              },
            },
          );
          const states = await requestJson<State[]>(
            page,
            `/api/projects/${encodeURIComponent(project.id)}/states`,
          );
          const source = states.find((state) => state.name === "To Do");
          const destination = states.find(
            (state) => state.name === "In Progress",
          );
          const forbidden = states.find((state) => state.name === "Backlog");
          if (!source || !destination || !forbidden)
            throw new Error("Default board states missing");

          const types = await requestJson<Array<{ id: string; key: string }>>(
            page,
            `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-types`,
          );
          const type = types.find((entry) => entry.key === "task");
          if (!type) throw new Error("Task type missing");
          const create = (title: string) =>
            requestJson<Item>(
              page,
              `/api/projects/${encodeURIComponent(project.id)}/work-items`,
              { method: "POST", data: { typeId: type.id, title } },
            );
          const anchor = await create("Backlog anchor");
          await requestJson(
            page,
            `/api/work-items/${encodeURIComponent(anchor.key)}/transition`,
            {
              method: "POST",
              data: { toStateTemplateId: forbidden.stateTemplateId },
            },
          );

          // Publish a real workflow that omits just To Do -> Backlog, leaving all other edges.
          const workflows = await requestJson<
            Array<{ id: string; activeVersionId: string }>
          >(
            page,
            `/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`,
          );
          const workflow = workflows.find((entry) => entry.activeVersionId);
          if (!workflow) throw new Error("Default workflow missing");
          const details = await requestJson<{
            versions: Array<{ id: string; transitions: Transition[] }>;
          }>(page, `/api/workflows/${encodeURIComponent(workflow.id)}`);
          const active = details.versions.find(
            (version) => version.id === workflow.activeVersionId,
          );
          if (!active) throw new Error("Active workflow version missing");
          const transitions = active.transitions.filter(
            (edge) =>
              edge.fromStateTemplateId !== source.stateTemplateId ||
              edge.toStateTemplateId !== forbidden.stateTemplateId,
          );
          expect(transitions.length).toBe(active.transitions.length - 1);
          const draft = await requestJson<{ number: number }>(
            page,
            `/api/workflows/${encodeURIComponent(workflow.id)}/versions`,
            { method: "POST", data: { transitions } },
          );
          await requestJson(
            page,
            `/api/workflows/${encodeURIComponent(workflow.id)}/versions/${draft.number}/publish`,
            { method: "POST", data: {} },
          );

          const first = await create("Destination first");
          const last = await create("Destination last");
          const moving = await create("Moving card");
          const refused = await create("Refused card");
          for (const item of [first, last]) {
            expect(item.stateId).toBe(source.id);
            await requestJson(
              page,
              `/api/work-items/${encodeURIComponent(item.key)}/transition`,
              {
                method: "POST",
                data: { toStateTemplateId: destination.stateTemplateId },
              },
            );
          }
          // Transitions do not promise distinct ranks in the destination: establish the
          // two-card order through the real rank API before testing the middle slot.
          await requestJson(
            page,
            `/api/work-items/${encodeURIComponent(last.key)}/rank`,
            {
              method: "POST",
              data: { beforeId: first.id },
            },
          );
          const offers = await requestJson<
            Array<{ toStateId: string; available: boolean }>
          >(
            page,
            `/api/work-items/${encodeURIComponent(refused.key)}/transitions`,
          );
          expect(offers.some((offer) => offer.toStateId === forbidden.id)).toBe(
            false,
          );
          await page.goto(
            new URL(
              `/agent/projects/${encodeURIComponent(slug)}/work?layout=board&sort=position&dir=asc`,
              origin,
            ).toString(),
          );
          const board = page.getByTestId("work-item-board");
          const column = (state: State) =>
            board.locator(
              `[data-testid="work-item-board-column"][data-state-id="${state.id}"]`,
            );
          const card = (key: string) =>
            board.locator(
              `[data-testid="work-item-board-card"][data-work-item-key="${key}"]`,
            );
          const ids = (state: State) =>
            column(state)
              .getByTestId("work-item-board-card")
              .evaluateAll((nodes) =>
                nodes.map((node) => node.getAttribute("data-work-item-key")),
              );
          await expect(card(moving.key)).toBeVisible();
          await expect
            .poll(() => ids(destination))
            .toEqual([first.key, last.key]);
          let release!: () => void;
          let received!: () => void;
          const receivedResponse = new Promise<void>((resolve) => {
            received = resolve;
          });
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          let transitionStatus = 0;
          const transitionPath = `/api/work-items/${encodeURIComponent(moving.key)}/transition`;
          await page.route(`**${transitionPath}`, async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            const response = await route.fetch();
            transitionStatus = response.status();
            received();
            await held;
            await route.fulfill({ response });
          });
          let rankResponse:
            | Promise<import("@playwright/test").Response>
            | undefined;
          try {
            await dragCard(
              page,
              card(moving.key).locator("[data-task-id]"),
              card(last.key).locator("[data-task-id]"),
            );
            await receivedResponse;
            expect(transitionStatus).toBe(200);
            await expect
              .poll(() => ids(destination))
              .toEqual([first.key, moving.key, last.key]);
            await expect(card(moving.key)).toHaveAttribute(
              "data-pending",
              "true",
            );
            rankResponse = page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname ===
                  `/api/work-items/${encodeURIComponent(moving.key)}/rank` &&
                response.request().method() === "POST",
            );
            await testInfo.attach("pending-board-drop", {
              body: await page.screenshot(),
              contentType: "image/png",
            });
          } finally {
            release();
          }
          if (!rankResponse)
            throw new Error("Rank response listener not registered");
          expect((await rankResponse).status()).toBe(200);
          await expect(card(moving.key)).not.toHaveAttribute("data-pending");
          await expect
            .poll(() => ids(destination))
            .toEqual([first.key, moving.key, last.key]);
          await page.reload();
          await expect
            .poll(() => ids(destination))
            .toEqual([first.key, moving.key, last.key]);
          await testInfo.attach("persisted-board-drop", {
            body: await page.screenshot(),
            contentType: "image/png",
          });

          const keyboardCard = card(refused.key).locator("[data-task-id]");
          await keyboardCard.focus();
          await expect(keyboardCard).toBeFocused();
          await page.keyboard.press("Space");
          await expect(keyboardCard).toHaveAttribute(
            "data-task-dragging",
            "true",
          );
          await page.keyboard.press("ArrowLeft");
          await expect(
            page
              .locator('[aria-live="assertive"]')
              .filter({ hasText: "is over Backlog anchor" }),
          ).toHaveCount(1);
          await page.keyboard.press("Space");
          await expect(
            column(source)
              .getByTestId("work-item-board-card")
              .filter({ hasText: refused.key }),
          ).toHaveCount(1);
          await expect(keyboardCard).toBeFocused();
          await expect(board.getByRole("status")).toHaveText(
            `Move refused. ${refused.key} is back in ${source.name}.`,
          );
          await expect(
            page.getByText(
              `${refused.key} can't move to that state right now.`,
            ),
          ).toBeVisible();
          await testInfo.attach("refused-board-drop", {
            body: await page.screenshot(),
            contentType: "image/png",
          });
        } finally {
          await context.close();
        }
      },
      {
        onContainerCreated: (id) => {
          containers.push(id);
          console.info(`Board fixture container: ${id}`);
        },
      },
    );
  } finally {
    console.info(
      `Board fixture containers created: ${containers.length ? containers.join(", ") : "none"}`,
    );
  }
});
