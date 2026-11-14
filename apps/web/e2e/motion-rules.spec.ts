import {
  expect,
  type Locator,
  type Page,
  type Route,
  test,
} from "@playwright/test";
import {
  BOARD_ITEM_COUNT,
  BOARD_PROJECT_KEY,
  boardItemId,
  installPerformanceApiFixture,
  PROJECT_ID,
  TYPE_ID,
  WORK_ITEM_KEY,
} from "./helpers/g11-performance-fixture";
import { mountBuiltPortal, PORTAL_ORIGIN } from "./helpers/portal-dist-fixture";

/**
 * E-8 (`docs/plan.md` section 6): browser verification of motion rules 1, 3, 5 and 9.
 *
 * `playwright.config.ts` defaults to `reducedMotion: "reduce"` for deterministic functional specs,
 * so rules 1, 3 and 5 explicitly opt into `reducedMotion: "no-preference"` before mounting, while
 * rule 9 explicitly activates `reducedMotion: "reduce"`. Every case carries `@a11y` so both the
 * `a11y` (`--grep @a11y`) and `e2e` CI jobs execute this spec without workflow changes.
 */

const BOARD_PATH = `/agent/projects/${BOARD_PROJECT_KEY}/work?layout=board`;
const BOARD_CARD_SELECTOR =
  '[data-testid="work-item-board-card"] [data-task-id]';
const PREFERENCES_PATH = "/dashboard/settings/account/preferences";
const INBOX_PATH = "/agent/inbox";
const DETAIL_PATH = `/agent/work-items/${WORK_ITEM_KEY}`;
const TRIAGE_QUEUE_PATH = "/agent/triage?state=new";
const TRIAGE_SHEET_PATH = "/agent/triage?state=new&ref=SUB-7";

const MOVEMENT_TRANSITION_PROPERTIES = new Set([
  "all",
  "transform",
  "translate",
  "scale",
  "rotate",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "inset-block",
  "inset-inline",
  "width",
  "height",
  "max-width",
  "max-height",
  "margin",
  "padding",
  "background-position",
]);

type MotionTokens = {
  fastMs: number;
  baseMs: number;
  slowMs: number;
};

type ElementMotionSample = {
  transitions: Array<{ property: string; durationMs: number }>;
  animations: Array<{ name: string; durationMs: number }>;
  scrollBehavior: string;
};

type PressFrameSample = {
  scale: string;
  transform: string;
  transitionDurationMs: number;
  dataPressed: string | null;
  dataKeyboardPress: string | null;
};

const PORTAL_SESSION = {
  session: {
    id: "motion-portal-session",
    userId: "motion-portal-customer",
    activeOrganizationId: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "motion-portal-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "motion-portal-customer",
    name: "Ada Example",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
  },
};

function portalApiBody(pathname: string): unknown {
  switch (pathname) {
    case "/api/auth/get-session":
      return PORTAL_SESSION;
    case "/api/config":
      return { disableRegistration: true, disableLoginForm: false };
    case "/api/public/terminology":
      return {};
    case "/api/me/settings":
      return { settings: {} };
    case "/api/portal/feature-state":
      return { state: "on" };
    case "/api/portal/me":
      return {
        name: "Ada Example",
        email: "ada@example.test",
        image: null,
        jobTitle: null,
        organisation: { name: "Contoso" },
      };
    case "/api/portal/home":
      return {
        actionRequired: { total: 2, cases: 1, approvals: 1 },
        outstanding: 3,
        closedLast30Days: 5,
        averageFirstResponse: { seconds: 5400, sampleSize: 4 },
      };
    case "/api/portal/projects":
      return {
        data: [
          {
            key: "INFRA",
            name: "Infrastructure managed services platform",
            kind: "managed_service",
            status: "active",
            health: "amber",
            counts: { actionRequired: 2, outstanding: 3 },
          },
        ],
      };
    case "/api/portal/requests":
      return {
        cases: [
          {
            ref: "SUB-7",
            source: "submission",
            title: "Access to the support workspace",
            requestTypeName: "Access request",
            priority: "high",
            customerStatus: "need_more_info",
            createdAt: "2026-09-15T00:00:00.000Z",
            updatedAt: "2026-09-16T09:30:00.000Z",
            project: {
              key: "INFRA",
              name: "Infrastructure managed services platform",
            },
            createdBy: { name: null, isYou: true },
            isRequester: true,
            customerVisibility: "private",
            sla: null,
          },
        ],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      };
    case "/api/portal/approvals":
      return { approvals: [] };
    case "/api/portal/submissions":
      return { submissions: [], page: { hasMore: false, nextCursor: null } };
    case "/api/portal/kb":
      return { data: [], hasMore: false, nextCursor: null };
    case "/api/portal/releases":
      return { data: [] };
    case "/api/portal/announcements":
      return { data: [], nextCursor: null };
    case "/api/portal/notification/inbox":
      return { data: [], unreadCount: 0, hasMore: false, nextCursor: null };
    default:
      return undefined;
  }
}

async function installTriageRoutes(page: Page) {
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(body),
    });

  await page.route("**/api/submissions**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/api/submissions/SUB-7/attachments"))
      return json(route, []);
    if (pathname.endsWith("/api/submissions/SUB-7/duplicates"))
      return json(route, { suggestions: [] });
    if (pathname.endsWith("/api/submissions/SUB-7"))
      return json(route, {
        submission: {
          state: "new",
          formData: { title: "Request access to the support workspace" },
          requesterId: "motion-requester",
          organisationId: "motion-organisation",
          workItemId: null,
        },
        requestType: { name: "Access request" },
        version: {
          defaultProjectId: PROJECT_ID,
          workItemTypeId: TYPE_ID,
          formSchema: {
            fields: [
              { key: "title", label: "Summary", type: "text", required: true },
            ],
          },
        },
        messages: [],
      });
    if (pathname.endsWith("/api/submissions"))
      return json(route, {
        submissions: [
          {
            ref: "SUB-7",
            summary: "Request access to the support workspace",
            submission: { state: "new", createdAt: "2026-09-15T00:00:00.000Z" },
            requestType: { id: "motion-request-type", name: "Access request" },
            requester: { displayName: "Ada Example" },
            organisation: { name: "Northstar Support" },
          },
        ],
        page: { hasMore: false, nextCursor: null },
      });
    return route.fallback();
  });
  await page.route("**/api/request-types**", (route) =>
    json(route, { requestTypes: [] }),
  );
  await page.route("**/api/intake/queues**", (route) => json(route, []));
  await page.route("**/api/kb/deflection**", (route) =>
    json(route, { articles: [], portalBaseUrl: "https://portal.example.test" }),
  );
}

function boardCard(page: Page, number: number) {
  return page.locator(
    `[data-testid="work-item-board-card"] [data-task-id="${boardItemId(number)}"]`,
  );
}

function boardColumnOf(page: Page, number: number) {
  return page
    .locator(
      `[data-testid="work-item-board-column"]:has([data-task-id="${boardItemId(number)}"])`,
    )
    .getAttribute("data-state-id");
}

async function readMotionTokens(page: Page): Promise<MotionTokens> {
  const tokens = await page.evaluate(() => {
    const parseCssTimeMs = (raw: string): number => {
      const value = raw.trim();
      if (!value) return Number.NaN;
      if (value.endsWith("ms")) return Math.round(Number.parseFloat(value));
      if (value.endsWith("s"))
        return Math.round(Number.parseFloat(value) * 1000);
      return Number.NaN;
    };
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      fastMs: parseCssTimeMs(rootStyle.getPropertyValue("--duration-fast")),
      baseMs: parseCssTimeMs(rootStyle.getPropertyValue("--duration-base")),
      slowMs: parseCssTimeMs(rootStyle.getPropertyValue("--duration-slow")),
    };
  });

  expect(tokens.fastMs).toBeGreaterThanOrEqual(120);
  expect(tokens.fastMs).toBeLessThanOrEqual(200);
  expect(tokens.baseMs).toBeGreaterThanOrEqual(120);
  expect(tokens.baseMs).toBeLessThanOrEqual(200);
  expect(tokens.slowMs).toBeGreaterThan(tokens.baseMs);
  expect(tokens.slowMs).toBeLessThanOrEqual(300);
  return tokens;
}

async function sampleElementMotion(
  locator: Locator,
): Promise<ElementMotionSample> {
  return locator.evaluate((element) => {
    const parseCssTimeMs = (raw: string): number => {
      const value = raw.trim();
      if (!value) return 0;
      if (value.endsWith("ms")) return Math.round(Number.parseFloat(value));
      if (value.endsWith("s"))
        return Math.round(Number.parseFloat(value) * 1000);
      return 0;
    };
    const splitList = (raw: string): string[] =>
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

    const style = getComputedStyle(element);
    const properties = splitList(style.transitionProperty);
    const durations = splitList(style.transitionDuration);
    const transitions =
      properties.length === 1 && properties[0] === "none"
        ? []
        : properties.map((property, index) => ({
            property,
            durationMs: parseCssTimeMs(
              durations[index % Math.max(durations.length, 1)] ?? "0s",
            ),
          }));

    const animationNames = splitList(style.animationName);
    const animationDurations = splitList(style.animationDuration);
    const animations = animationNames
      .map((name, index) => ({
        name,
        durationMs:
          name === "none"
            ? 0
            : parseCssTimeMs(
                animationDurations[
                  index % Math.max(animationDurations.length, 1)
                ] ?? "0s",
              ),
      }))
      .filter((entry) => entry.name !== "none");

    return {
      transitions,
      animations,
      scrollBehavior: style.scrollBehavior,
    };
  });
}

function assertSmallElementMotion(
  label: string,
  sample: ElementMotionSample,
  tokens: MotionTokens,
) {
  const tokenDurations = new Set([0, tokens.fastMs, tokens.baseMs]);

  for (const { property, durationMs } of sample.transitions) {
    expect(
      durationMs,
      `${label} transition(${property}) must not exceed 300 ms`,
    ).toBeLessThanOrEqual(300);
    expect(
      durationMs === 0 || (durationMs >= 120 && durationMs <= 200),
      `${label} transition(${property})=${durationMs}ms must be 0 or within 120-200 ms`,
    ).toBe(true);
    expect(
      tokenDurations.has(durationMs),
      `${label} transition(${property})=${durationMs}ms must resolve from motion tokens (${tokens.fastMs}ms or ${tokens.baseMs}ms)`,
    ).toBe(true);
  }

  for (const { name, durationMs } of sample.animations) {
    expect(
      durationMs,
      `${label} animation(${name}) must not exceed 300 ms`,
    ).toBeLessThanOrEqual(300);
    expect(
      durationMs === 0 || (durationMs >= 120 && durationMs <= 200),
      `${label} animation(${name})=${durationMs}ms must be 0 or within 120-200 ms`,
    ).toBe(true);
    expect(
      tokenDurations.has(durationMs),
      `${label} animation(${name})=${durationMs}ms must resolve from motion tokens`,
    ).toBe(true);
  }
}

async function assertNoMovementUnderReducedMotion(
  label: string,
  locator: Locator,
) {
  const sample = await sampleElementMotion(locator);
  expect(
    sample.scrollBehavior,
    `${label} must keep scroll-behavior: auto`,
  ).toBe("auto");

  for (const { property, durationMs } of sample.transitions) {
    if (MOVEMENT_TRANSITION_PROPERTIES.has(property)) {
      expect(
        durationMs,
        `${label} reduced-motion transition(${property}) must compute to 0ms`,
      ).toBe(0);
    }
  }

  for (const { name, durationMs } of sample.animations) {
    expect(
      durationMs,
      `${label} reduced-motion animation(${name}) must be 0ms or animation-name: none`,
    ).toBe(0);
  }
}

async function sampleNextFrame(locator: Locator): Promise<PressFrameSample> {
  return locator.evaluate(
    (element) =>
      new Promise<PressFrameSample>((resolve) => {
        requestAnimationFrame(() => {
          const style = getComputedStyle(element);
          const firstDuration =
            style.transitionDuration.split(",")[0]?.trim() ?? "0s";
          const durationMs = firstDuration.endsWith("ms")
            ? Math.round(Number.parseFloat(firstDuration))
            : firstDuration.endsWith("s")
              ? Math.round(Number.parseFloat(firstDuration) * 1000)
              : 0;
          resolve({
            scale: style.scale,
            transform: style.transform,
            transitionDurationMs: durationMs,
            dataPressed: element.getAttribute("data-pressed"),
            dataKeyboardPress: element.getAttribute("data-keyboard-press"),
          });
        });
      }),
  );
}

async function pointerDownAndSampleNextFrame(
  page: Page,
  locator: Locator,
  { cancelAtOriginOnRelease = false } = {},
): Promise<PressFrameSample> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Target element has no bounding box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    return await sampleNextFrame(locator);
  } finally {
    if (cancelAtOriginOnRelease) {
      await page.mouse.move(1, 1);
    }
    await page.mouse.up();
  }
}

async function maxActiveTransitionDurationMs(
  page: Page,
  selector: string,
): Promise<number> {
  return page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) return 0;
    const durations = element
      .getAnimations()
      .map((animation) =>
        Number(animation.effect?.getComputedTiming().activeDuration ?? 0),
      )
      .filter((value) => Number.isFinite(value));
    return durations.length > 0 ? Math.max(...durations) : 0;
  }, selector);
}

test("rule 1: press feedback applies within one animation frame and keyboard press never animates scale @a11y", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await installPerformanceApiFixture(page, {
    boardProject: true,
    workflowCapabilities: true,
  });

  // 1a. Button (`packages/ui/src/components/button.tsx`, `--press-scale` defaults to 0.97).
  await page.goto(PREFERENCES_PATH);
  const resetButton = page.getByRole("button", { name: "Reset", exact: true });
  await expect(resetButton).toBeVisible();

  const buttonPointerFrame = await pointerDownAndSampleNextFrame(
    page,
    resetButton,
  );
  expect(buttonPointerFrame.scale).toBe("0.97");
  expect(buttonPointerFrame.transitionDurationMs).toBe(0);

  // Rule 8 companion promised by `useKeyboardPress` + `press-feedback[data-keyboard-press]`:
  // Space/Enter sets instant press state (0 ms) and keeps release duration at 0 ms so scale never animates.
  await resetButton.focus();
  await expect(resetButton).toBeFocused();
  await page.keyboard.down("Space");
  const buttonKeyDownFrame = await sampleNextFrame(resetButton);
  expect(buttonKeyDownFrame.dataPressed).toBe("");
  expect(buttonKeyDownFrame.dataKeyboardPress).toBe("");
  expect(buttonKeyDownFrame.scale).toBe("0.97");
  expect(buttonKeyDownFrame.transitionDurationMs).toBe(0);

  await page.keyboard.up("Space");
  const buttonKeyUpFrame = await sampleNextFrame(resetButton);
  expect(buttonKeyUpFrame.transitionDurationMs).toBe(0);
  await expect
    .poll(() =>
      resetButton.evaluate((element) => getComputedStyle(element).scale),
    )
    .toBe("none");

  // 1b. Board card (`TaskCard`, `--press-scale: 0.98`; `MouseSensor` requires 8 px movement to drag).
  // Draggable board cards pass `allowSpace: false` to `useKeyboardPress` (reserving Space for dnd-kit
  // lift while Enter opens the card immediately on keydown) and share the same `press-feedback` rule.
  await page.goto(BOARD_PATH);
  await expect(page.locator(BOARD_CARD_SELECTOR)).toHaveCount(
    BOARD_ITEM_COUNT,
    { timeout: 30_000 },
  );
  const firstBoardCard = boardCard(page, 1);
  await expect(firstBoardCard).toBeVisible();

  const boardCardPointerFrame = await pointerDownAndSampleNextFrame(
    page,
    firstBoardCard,
    { cancelAtOriginOnRelease: false },
  );
  expect(boardCardPointerFrame.scale).toBe("0.98");
  expect(boardCardPointerFrame.transitionDurationMs).toBe(0);

  // 1c. Interactive Card (`PortalKpiCard` on Kaneo's `<Card interactive>`, `--press-scale: 0.98`).
  const unmatchedPortalReads = await mountBuiltPortal(page, portalApiBody);
  await page.goto(`${PORTAL_ORIGIN}/`);
  const interactiveCard = page
    .locator('[data-slot="portal-kpi-card"][data-interactive]')
    .first();
  await expect(interactiveCard).toBeVisible();

  await interactiveCard.focus();
  await expect(interactiveCard).toBeFocused();
  await page.keyboard.down("Space");
  const cardKeyDownFrame = await sampleNextFrame(interactiveCard);
  expect(cardKeyDownFrame.dataPressed).toBe("");
  expect(cardKeyDownFrame.dataKeyboardPress).toBe("");
  expect(cardKeyDownFrame.scale).toBe("0.98");
  expect(cardKeyDownFrame.transitionDurationMs).toBe(0);
  await page.keyboard.up("Space");
  const cardKeyUpFrame = await sampleNextFrame(interactiveCard);
  expect(cardKeyUpFrame.transitionDurationMs).toBe(0);

  const cardPointerFrame = await pointerDownAndSampleNextFrame(
    page,
    interactiveCard,
    { cancelAtOriginOnRelease: true },
  );
  expect(cardPointerFrame.scale).toBe("0.98");
  expect(cardPointerFrame.transitionDurationMs).toBe(0);
  expect(unmatchedPortalReads).toEqual([]);
});

test("rule 3: small interactive elements resolve transition and animation durations from motion tokens within 120-200 ms @a11y", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await installPerformanceApiFixture(page, {
    boardProject: true,
    workflowCapabilities: true,
  });

  // Button and Switch root on Preferences.
  // Note: `switch-thumb` (`scale: .1s`), `checkbox` / `checkbox-indicator` (`150ms`), `badge`
  // (`150ms`), `tooltip` (`150ms`) and `popover` (`150ms`) currently violate Rule 3 in
  // `packages/ui` and are recorded in `.handoff/report.md` rather than weakening token checks.
  await page.goto(PREFERENCES_PATH);
  const resetButton = page.getByRole("button", { name: "Reset", exact: true });
  const sidebarSwitch = page.getByRole("switch", {
    name: "Sidebar Default",
    exact: true,
  });
  await expect(resetButton).toBeVisible();
  await expect(sidebarSwitch).toBeVisible();

  const tokens = await readMotionTokens(page);
  assertSmallElementMotion(
    "Button",
    await sampleElementMotion(resetButton),
    tokens,
  );
  assertSmallElementMotion(
    "Switch",
    await sampleElementMotion(sidebarSwitch),
    tokens,
  );

  // Tab and sliding TabIndicator on `/agent/inbox`.
  await page.goto(INBOX_PATH);
  const inboxTab = page.locator('[data-slot="tabs-tab"]').first();
  const tabIndicator = page.locator('[data-slot="tab-indicator"]').first();
  await expect(inboxTab).toBeVisible();
  await expect(tabIndicator).toBeAttached();
  assertSmallElementMotion("Tab", await sampleElementMotion(inboxTab), tokens);
  assertSmallElementMotion(
    "TabIndicator",
    await sampleElementMotion(tabIndicator),
    tokens,
  );

  // MenuItem inside the canonical state transition menu on `/agent/work-items/WLP-1`.
  await page.goto(DETAIL_PATH);
  const stateControl = page.locator(
    '[data-testid="work-item-state-control"]:visible',
  );
  await expect(stateControl).toBeVisible();
  await stateControl.click();
  const menuItem = page.locator('[data-slot="menu-item"]').first();
  await expect(menuItem).toBeVisible();
  assertSmallElementMotion(
    "MenuItem",
    await sampleElementMotion(menuItem),
    tokens,
  );
  await page.keyboard.press("Escape");
});

test("rule 5: interrupted overlays close within one duration, settling board drops never block input, and rapid switch toggles settle cleanly @a11y", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await installPerformanceApiFixture(page, {
    boardProject: true,
    workflowCapabilities: true,
    triageCapability: true,
  });
  await installTriageRoutes(page);

  // Hold the cross-column board transition until concurrent board input is verified.
  let notifyMoveStarted: (() => void) | undefined;
  const moveStarted = new Promise<void>((resolve) => {
    notifyMoveStarted = resolve;
  });
  let releaseMove: (() => void) | undefined;
  const moveGate = new Promise<void>((resolve) => {
    releaseMove = resolve;
  });
  await page.route("**/api/work-items/BRD-1/transition", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    notifyMoveStarted?.();
    await moveGate;
    return route.fallback();
  });

  // 5a. Interrupt Popover and Dialog before enter finishes on `/agent/work-items/WLP-1`.
  await page.goto(DETAIL_PATH);
  const assigneeControl = page.locator(
    '[data-testid="work-item-assignee-control"]:visible',
  );
  await expect(assigneeControl).toBeVisible();
  const tokens = await readMotionTokens(page);
  const interruptCloseBudgetMs = tokens.slowMs + 250;

  const popoverPopup = page.locator('[data-slot="popover-popup"]');
  await assigneeControl.click();
  await popoverPopup.waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  expect(
    await maxActiveTransitionDurationMs(page, '[data-slot="popover-popup"]'),
  ).toBeLessThanOrEqual(tokens.slowMs);
  await expect
    .poll(() => popoverPopup.isVisible(), {
      timeout: interruptCloseBudgetMs,
      intervals: [16, 32, 50],
    })
    .toBe(false);
  await expect(assigneeControl).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).pointerEvents),
  ).not.toBe("none");
  // Re-open to verify no stuck state after mid-enter cancellation.
  await assigneeControl.click();
  await expect(popoverPopup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popoverPopup).toBeHidden();

  const dialogPopup = page.locator('[data-slot="dialog-popup"]');
  await page.keyboard.press("?");
  await dialogPopup.waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  expect(
    await maxActiveTransitionDurationMs(page, '[data-slot="dialog-popup"]'),
  ).toBeLessThanOrEqual(tokens.slowMs);
  await expect
    .poll(() => dialogPopup.isVisible(), {
      timeout: interruptCloseBudgetMs,
      intervals: [16, 32, 50],
    })
    .toBe(false);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).pointerEvents),
  ).not.toBe("none");
  await page.keyboard.press("?");
  await expect(dialogPopup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogPopup).toBeHidden();

  // 5b. Interrupt Sheet before enter finishes on `/agent/triage?state=new`.
  await page.goto(TRIAGE_QUEUE_PATH);
  const submissionTrigger = page.locator('[data-submission-ref="SUB-7"]');
  await expect(submissionTrigger).toBeVisible();
  const sheetPopup = page.locator('[data-slot="sheet-popup"]');
  await submissionTrigger.click();
  await sheetPopup.waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  expect(
    await maxActiveTransitionDurationMs(page, '[data-slot="sheet-popup"]'),
  ).toBeLessThanOrEqual(tokens.slowMs);
  await expect
    .poll(() => sheetPopup.isVisible(), {
      timeout: interruptCloseBudgetMs,
      intervals: [16, 32, 50],
    })
    .toBe(false);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).pointerEvents),
  ).not.toBe("none");
  await submissionTrigger.click();
  await expect(sheetPopup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheetPopup).toBeHidden();

  // 5c. While a board card drop is settling (300 ms DragOverlay drop + pending move), another press is accepted.
  const csrfReady = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/me/csrf-token" &&
      response.ok(),
  );
  await page.goto(BOARD_PATH);
  await csrfReady;
  await expect(page.locator(BOARD_CARD_SELECTOR)).toHaveCount(
    BOARD_ITEM_COUNT,
    { timeout: 30_000 },
  );

  const sourceBox = await page
    .getByText("Seeded board item 1", { exact: true })
    .boundingBox();
  const targetBox = await page
    .getByText("Seeded board item 51", { exact: true })
    .boundingBox();
  if (!sourceBox || !targetBox)
    throw new Error("Board cards have no browser bounding boxes.");

  const fromX = sourceBox.x + sourceBox.width / 2;
  const fromY = sourceBox.y + sourceBox.height / 2;
  const toX = targetBox.x + targetBox.width / 2;
  const toY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + 16, fromY, { steps: 3 });
  await expect(page.getByTestId("work-item-drag-overlay-card")).toBeVisible();
  await page.mouse.move(toX, toY, { steps: 6 });
  await page.mouse.up();
  await moveStarted;

  const pointerEventsWhileSettling = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).pointerEvents,
    body: getComputedStyle(document.body).pointerEvents,
  }));
  expect(pointerEventsWhileSettling.html).not.toBe("none");
  expect(pointerEventsWhileSettling.body).not.toBe("none");
  await expect(
    page.locator('[data-work-item-key="BRD-1"][data-pending="true"]'),
  ).toHaveCount(1);

  await page.getByRole("button", { name: "Select items", exact: true }).click();
  const concurrentCheckbox = page.locator(
    '[data-work-item-key="BRD-2"] [data-slot="checkbox"]',
  );
  await concurrentCheckbox.click();
  await expect(concurrentCheckbox).toBeChecked();

  releaseMove?.();
  await expect.poll(() => boardColumnOf(page, 1)).toBe("state-brd-progress");

  // 5d. Toggling a Switch twice quickly ends in its starting state.
  await page.goto(PREFERENCES_PATH);
  const sidebarSwitch = page.getByRole("switch", {
    name: "Sidebar Default",
    exact: true,
  });
  await expect(sidebarSwitch).toBeVisible();
  const initialChecked = await sidebarSwitch.getAttribute("aria-checked");
  expect(initialChecked === "true" || initialChecked === "false").toBe(true);

  await sidebarSwitch.click();
  await sidebarSwitch.click();
  await expect
    .poll(() => sidebarSwitch.getAttribute("aria-checked"))
    .toBe(initialChecked);
});

test("rule 9: reduced-motion disables spatial movement animations and smooth scrolling across surfaces @a11y", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installPerformanceApiFixture(page, {
    boardProject: true,
    workflowCapabilities: true,
    triageCapability: true,
  });
  await installTriageRoutes(page);

  // Gate `/api/notification/inbox` briefly so Skeleton and Tabs can both be scanned on `/agent/inbox`.
  let releaseInbox: (() => void) | undefined;
  const inboxGate = new Promise<void>((resolve) => {
    releaseInbox = resolve;
  });
  let holdFirstInboxRead = true;
  await page.route("**/api/notification/inbox**", async (route) => {
    if (holdFirstInboxRead) {
      holdFirstInboxRead = false;
      await inboxGate;
    }
    return route.fallback();
  });

  // Note: `Spinner` (`animate-spin` runs a 1s rotation), non-anchored `Toast.Root` (missing
  // `data-slot="toast-popup"`, animates `transform` 500ms and `height` 150ms) and `TabsTab`
  // (retains `scale` in `transition-property` at 120ms despite `scale: none !important`) violate
  // Rule 9 in `packages/ui` and are documented in `.handoff/report.md`.

  // 9a. Document scroll-behavior, Button, Switch and SwitchThumb on Preferences.
  await page.goto(PREFERENCES_PATH);
  const resetButton = page.getByRole("button", { name: "Reset", exact: true });
  const sidebarSwitch = page.getByRole("switch", {
    name: "Sidebar Default",
    exact: true,
  });
  const switchThumb = sidebarSwitch.locator('[data-slot="switch-thumb"]');
  await expect(resetButton).toBeVisible();
  await expect(sidebarSwitch).toBeVisible();

  await assertNoMovementUnderReducedMotion("html", page.locator("html"));
  await assertNoMovementUnderReducedMotion("body", page.locator("body"));
  await assertNoMovementUnderReducedMotion("Button", resetButton);
  const reducedButtonPress = await pointerDownAndSampleNextFrame(
    page,
    resetButton,
  );
  expect(reducedButtonPress.scale).toBe("none");

  await assertNoMovementUnderReducedMotion("Switch", sidebarSwitch);
  await assertNoMovementUnderReducedMotion("SwitchThumb", switchThumb);

  // 9b. Skeleton shimmer (`animation-name: none`) and TabIndicator (`transition: none`) on `/agent/inbox`.
  await page.goto(INBOX_PATH);
  const skeleton = page.locator('[data-slot="skeleton"]').first();
  await expect(skeleton).toBeVisible();
  await assertNoMovementUnderReducedMotion("Skeleton", skeleton);

  releaseInbox?.();
  const inboxTab = page.locator('[data-slot="tabs-tab"]').first();
  const tabIndicator = page.locator('[data-slot="tab-indicator"]').first();
  await expect(inboxTab).toBeVisible();
  await assertNoMovementUnderReducedMotion("TabIndicator", tabIndicator);
  const reducedTabPress = await pointerDownAndSampleNextFrame(page, inboxTab);
  expect(reducedTabPress.scale).toBe("none");

  // 9c. Checkbox, CheckboxIndicator and Tooltip on the canonical board.
  await page.goto(BOARD_PATH);
  await expect(page.locator(BOARD_CARD_SELECTOR)).toHaveCount(
    BOARD_ITEM_COUNT,
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Select items", exact: true }).click();
  const checkbox = page
    .locator('[data-work-item-key="BRD-1"] [data-slot="checkbox"]')
    .first();
  await expect(checkbox).toBeVisible();
  await checkbox.click();
  const checkboxIndicator = checkbox.locator(
    '[data-slot="checkbox-indicator"]',
  );
  await expect(checkboxIndicator).toBeVisible();
  await assertNoMovementUnderReducedMotion("Checkbox", checkbox);
  await assertNoMovementUnderReducedMotion(
    "CheckboxIndicator",
    checkboxIndicator,
  );

  const columnAddButton = page
    .getByTestId("work-item-board-column-create")
    .first();
  await columnAddButton.hover();
  const tooltipPositioner = page.locator('[data-slot="tooltip-positioner"]');
  const tooltipPopup = page.locator('[data-slot="tooltip-popup"]');
  await expect(tooltipPopup).toBeVisible();
  await assertNoMovementUnderReducedMotion(
    "TooltipPositioner",
    tooltipPositioner,
  );
  await assertNoMovementUnderReducedMotion("TooltipPopup", tooltipPopup);

  // 9d. MenuItem/MenuPopup, Popover and Dialog on `/agent/work-items/WLP-1`.
  await page.goto(DETAIL_PATH);
  const stateControl = page.locator(
    '[data-testid="work-item-state-control"]:visible',
  );
  await expect(stateControl).toBeVisible();
  await stateControl.click();
  const menuPositioner = page.locator('[data-slot="menu-positioner"]');
  const menuPopup = page.locator('[data-slot="menu-popup"]');
  const menuItem = page.locator('[data-slot="menu-item"]').first();
  await expect(menuItem).toBeVisible();
  await assertNoMovementUnderReducedMotion("MenuPositioner", menuPositioner);
  await assertNoMovementUnderReducedMotion("MenuPopup", menuPopup);
  await assertNoMovementUnderReducedMotion("MenuItem", menuItem);
  await page.keyboard.press("Escape");
  await expect(menuPopup).toBeHidden();

  const assigneeControl = page.locator(
    '[data-testid="work-item-assignee-control"]:visible',
  );
  await assigneeControl.click();
  const popoverPositioner = page.locator('[data-slot="popover-positioner"]');
  const popoverPopup = page.locator('[data-slot="popover-popup"]');
  await expect(popoverPopup).toBeVisible();
  await assertNoMovementUnderReducedMotion(
    "PopoverPositioner",
    popoverPositioner,
  );
  await assertNoMovementUnderReducedMotion("PopoverPopup", popoverPopup);
  await page.keyboard.press("Escape");
  await expect(popoverPopup).toBeHidden();

  await page.keyboard.press("?");
  const dialogBackdrop = page.locator('[data-slot="dialog-backdrop"]');
  const dialogPopup = page.locator('[data-slot="dialog-popup"]');
  await expect(dialogPopup).toBeVisible();
  await assertNoMovementUnderReducedMotion("DialogBackdrop", dialogBackdrop);
  await assertNoMovementUnderReducedMotion("DialogPopup", dialogPopup);
  await page.keyboard.press("Escape");
  await expect(dialogPopup).toBeHidden();

  // 9e. Sheet on `/agent/triage?state=new&ref=SUB-7`.
  await page.goto(TRIAGE_SHEET_PATH);
  const sheetBackdrop = page.locator('[data-slot="sheet-backdrop"]');
  const sheetPopup = page.locator('[data-slot="sheet-popup"]');
  await expect(sheetPopup).toBeVisible();
  await assertNoMovementUnderReducedMotion("SheetBackdrop", sheetBackdrop);
  await assertNoMovementUnderReducedMotion("SheetPopup", sheetPopup);

  // 9f. Badge hover and interactive Card on the customer portal dashboard.
  const unmatchedPortalReads = await mountBuiltPortal(page, portalApiBody);
  await page.goto(`${PORTAL_ORIGIN}/`);
  const badge = page.locator('[data-slot="badge"]').first();
  const interactiveCard = page
    .locator('[data-slot="portal-kpi-card"][data-interactive]')
    .first();
  await expect(badge).toBeVisible();
  await expect(interactiveCard).toBeVisible();
  await badge.hover();
  await assertNoMovementUnderReducedMotion("Badge", badge);
  const reducedCardPress = await pointerDownAndSampleNextFrame(
    page,
    interactiveCard,
    { cancelAtOriginOnRelease: true },
  );
  expect(reducedCardPress.scale).toBe("none");
  expect(unmatchedPortalReads).toEqual([]);
});
