import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  makeWorkItem,
  PROJECT_ID,
  WORK_ITEM_KEY,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

/**
 * UAT re-audit (d35d165) regressions on the work-item detail and the create dialog, checked
 * where they show: real layout at phone width, computed colour, keyboard and focus.
 */
const LONG_AUTHOR = "Katherine Johnson-Featherstonehaugh of the Customer Desk";
const LONG_PERSON = "Maximilian Alexander Wolfeschlegelsteinhausen";
const LONG_EMAIL = "emma.clarke@contoso.uat.taskdesk.example";

async function detailFixture(page: Page) {
  await installPerformanceApiFixture(page, { workflowCapabilities: true });
  await page.route(`**/api/work-items/${WORK_ITEM_KEY}`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            ...makeWorkItem(1),
            title: "Seeded work item 1",
            assigneeId: "person-long",
            assigneeName: LONG_PERSON,
            assigneeActive: true,
            assigneeOnProject: true,
            requesterId: "customer-long",
            requesterName: LONG_AUTHOR,
          },
        })
      : route.fallback(),
  );
  await page.route(`**/api/work-items/${WORK_ITEM_KEY}/attachments*`, (route) =>
    route.fulfill({
      json: [
        {
          id: "file-1",
          filename: "invoice-october.pdf",
          mimeType: "application/pdf",
          size: 48_213,
          state: "ready",
          uploadedBy: "customer-long",
          createdAt: "2026-10-30T10:00:00.000Z",
          deletedAt: null,
          canDelete: true,
          commentId: null,
          customerVisible: true,
        },
      ],
    }),
  );
  await page.route(`**/api/work-items/${WORK_ITEM_KEY}/activity*`, (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "activity-upload",
            kind: "activity",
            workItemId: "work-item-1",
            actorId: "customer-long",
            actorType: "person",
            actorPersonId: "customer-long",
            actorDisplayName: "Katherine Johnson",
            verb: "attachment.added",
            field: null,
            oldValue: null,
            newValue: null,
            payload: {
              attachmentId: "file-1",
              filename: "invoice-october.pdf",
            },
            visibility: "public",
            workflowVersionId: null,
            createdAt: "2026-10-30T10:00:01.000Z",
          },
          {
            id: "comment-long",
            kind: "comment",
            workItemId: "work-item-1",
            actorId: "customer-long",
            actorType: "person",
            actorPersonId: "customer-long",
            actorDisplayName: LONG_AUTHOR,
            verb: "commented",
            field: null,
            oldValue: null,
            newValue: null,
            payload: null,
            visibility: "public",
            workflowVersionId: null,
            createdAt: "2026-10-30T10:00:00.000Z",
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Invoice attached." }],
                },
              ],
            },
            activityId: null,
            editedAt: null,
            deletedAt: null,
            deletedBy: null,
            updatedAt: "2026-10-30T10:00:00.000Z",
            canEdit: false,
            canDelete: false,
          },
        ],
        page: { hasMore: false, nextCursor: null },
      },
    }),
  );
}

type Theme = "light" | "dark";
const THEMES: readonly Theme[] = ["light", "dark"];

/** The agent app reads its theme from persisted preferences (default dark). */
async function useTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => {
    localStorage.setItem(
      "user-preferences",
      JSON.stringify({ state: { theme: value }, version: 0 }),
    );
  }, theme);
}

async function expectTheme(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

/** WCAG contrast of an element's text against the first opaque background behind it. */
async function textContrast(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const parse = (value: string) => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.append(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.fillStyle = rgb;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255] as const;
      };
      const backgrounds: (readonly [number, number, number, number])[] = [];
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const background = parse(getComputedStyle(node).backgroundColor);
        if (background[3] > 0) backgrounds.push(background);
        if (background[3] >= 1) break;
      }
      let base = [255, 255, 255];
      for (const [r, g, b, a] of backgrounds.reverse())
        base = [r, g, b].map((channel, index) =>
          Math.round(channel * a + base[index] * (1 - a)),
        );
      const [fr, fg, fb, fa] = parse(getComputedStyle(element).color);
      const text = [fr, fg, fb].map((channel, index) =>
        Math.round(channel * fa + base[index] * (1 - fa)),
      );
      const luminance = (rgb: number[]) => {
        const [r, g, b] = rgb.map((channel) => {
          const value = channel / 255;
          return value <= 0.03928
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [light, dark] = [luminance(text), luminance(base)].sort(
        (left, right) => right - left,
      );
      return (light + 0.05) / (dark + 0.05);
    });
}

for (const colorScheme of THEMES) {
  test(`detail at 375 keeps properties, author and meta readable (${colorScheme})`, async ({
    page,
  }, testInfo) => {
    await useTheme(page, colorScheme);
    await page.setViewportSize({ width: 375, height: 812 });
    await detailFixture(page);
    await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
    await expectTheme(page, colorScheme);
    const strip = page.getByTestId("work-item-property-controls");
    await expect(strip).toBeVisible();

    // The strip and each row stay inside the 375px viewport (no left overflow).
    for (const control of ["state", "priority", "assignee", "requester"]) {
      const box = await page
        .getByTestId(`work-item-${control}-control`)
        .boundingBox();
      expect(box, control).not.toBeNull();
      expect(box?.x ?? -1, control).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0), control).toBeLessThanOrEqual(
        375,
      );
    }

    // The requester row says it is the requester.
    await expect(page.getByTestId("work-item-requester-control")).toContainText(
      `Requester: ${LONG_AUTHOR}`,
    );

    // The comment author chip ends inside its card.
    const card = page.locator("#comment-comment-long");
    await expect(card).toBeVisible();
    const author = card.getByRole("button", { name: LONG_AUTHOR });
    const [cardBox, authorBox] = await Promise.all([
      card.boundingBox(),
      author.boundingBox(),
    ]);
    expect((authorBox?.x ?? 0) + (authorBox?.width ?? 0)).toBeLessThanOrEqual(
      (cardBox?.x ?? 0) + (cardBox?.width ?? 0) + 0.5,
    );

    // The customer's upload is named by the server, never "Unknown".
    const activity = page.getByTestId("work-item-activity");
    await expect(activity).toContainText("Katherine Johnson");
    await expect(activity).not.toContainText("Unknown");

    // Attachment meta meets AA (4.5:1) for its small text.
    await page.getByRole("button", { name: "Attachments" }).click();
    await expect(
      page.locator(".taskdesk-attachment-card-meta").first(),
    ).toBeVisible();
    expect(
      await textContrast(page, ".taskdesk-attachment-card-meta"),
    ).toBeGreaterThanOrEqual(4.5);

    await page.screenshot({
      path: testInfo.outputPath(`detail-375-${colorScheme}.png`),
    });
    await page.getByTestId("work-item-activity").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`detail-375-activity-${colorScheme}.png`),
    });
  });

  test(`detail keeps its project highlighted in the sidebar and the title focus visible (${colorScheme})`, async ({
    page,
  }, testInfo) => {
    await useTheme(page, colorScheme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await detailFixture(page);
    await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
    await expectTheme(page, colorScheme);
    await expect(page.getByTestId("work-item-property-controls")).toBeVisible();
    await expect(
      page.locator('[data-sidebar="menu-button"][data-active="true"]', {
        hasText: "Performance fixture",
      }),
    ).toHaveCount(1);

    const title = page.getByRole("textbox", { name: /title/i }).first();
    await title.focus();
    const ring = await title.evaluate(
      (element) =>
        getComputedStyle(
          element.closest("[data-slot=textarea-control]") as Element,
        ).boxShadow,
    );
    expect(ring).not.toBe("none");
    await page.screenshot({
      path: testInfo.outputPath(`detail-1440-title-focus-${colorScheme}.png`),
    });
  });
}

test("status moves open from the keyboard, move with arrows and return focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await detailFixture(page);
  await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
  const trigger = page.getByTestId("work-item-state-control");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  // The moves load when the menu opens; arrow keys then move between them.
  const first = page.getByRole("menuitem").first();
  await expect(first).toBeVisible();
  if (!(await first.evaluate((element) => element === document.activeElement)))
    await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const colorScheme of THEMES)
  test(`create dialog pickers are radio menus with start-aligned rows and truncated emails (${colorScheme})`, async ({
    page,
  }, testInfo) => {
    await useTheme(page, colorScheme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await installPerformanceApiFixture(page);
    await page.route(
      `**/api/projects/${PROJECT_ID}/requester-candidates`,
      (route) =>
        route.fulfill({
          json: [
            { personId: "customer-1", name: "Emma Clarke", email: LONG_EMAIL },
          ],
        }),
    );
    await page.goto(WORK_LIST_PATH);
    await page.getByTestId("create-work-item-trigger").click();

    const priority = page.getByTestId("create-work-item-priority-trigger");
    await expect(priority).toBeVisible();
    await priority.focus();
    await page.keyboard.press("ArrowDown");
    const options = page.getByRole("menuitemradio");
    await expect(options.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toBeFocused();
    await expect(options.first()).toHaveAttribute("aria-checked", "true");
    // Kaneo rows start at the left edge of the menu.
    const [menuBox, labelBox] = await Promise.all([
      page.getByRole("menu").boundingBox(),
      options
        .nth(1)
        .getByText(/Low|Medium|High|Urgent/)
        .boundingBox(),
    ]);
    expect((labelBox?.x ?? 0) - (menuBox?.x ?? 0)).toBeLessThan(48);
    await page.screenshot({
      path: testInfo.outputPath(`create-priority-menu-${colorScheme}.png`),
    });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(priority).toBeFocused();

    await page.getByTestId("create-work-item-requester-trigger").click();
    const person = page.getByRole("button", { name: "Emma Clarke" });
    const email = person.getByText(LONG_EMAIL);
    const [personBox, emailBox] = await Promise.all([
      person.boundingBox(),
      email.boundingBox(),
    ]);
    // The email is clipped inside the row with an ellipsis, not cut at the row edge.
    expect((emailBox?.x ?? 0) + (emailBox?.width ?? 0)).toBeLessThanOrEqual(
      (personBox?.x ?? 0) + (personBox?.width ?? 0),
    );
    expect(
      await email.evaluate(
        (element) =>
          getComputedStyle(element).textOverflow === "ellipsis" &&
          element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const noRequester = page.getByRole("button", {
      name: "No requester",
    });
    expect(
      await noRequester.evaluate(
        (element) => getComputedStyle(element).justifyContent,
      ),
    ).toBe("flex-start");
    // Its check sits at the end of the row, as in Kaneo.
    const [noneBox, checkBox] = await Promise.all([
      noRequester.boundingBox(),
      noRequester.locator("svg").last().boundingBox(),
    ]);
    expect(
      (noneBox?.x ?? 0) +
        (noneBox?.width ?? 0) -
        ((checkBox?.x ?? 0) + (checkBox?.width ?? 0)),
    ).toBeLessThan(16);
    await page.screenshot({
      path: testInfo.outputPath(`create-requester-picker-${colorScheme}.png`),
    });
  });

test("a move that needs a note opens its note form from the status menu, sends the note and returns focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await detailFixture(page);
  const posted: unknown[] = [];
  await page.route(`**/api/work-items/${WORK_ITEM_KEY}/transitions`, (route) =>
    route.fulfill({
      json: [
        {
          transitionId: "transition-review",
          toStateTemplateId: "template-review",
          toStateName: "Review",
          toStateId: "state-review",
          toStateCategory: "started",
          notePolicy: "required",
          noteVisibility: "internal",
          requiresApproval: false,
          requiresCab: false,
          isReopen: false,
          available: false,
          blockedBy: [{ reasonCode: "note.required" }],
        },
      ],
    }),
  );
  await page.route(`**/api/work-items/${WORK_ITEM_KEY}/transition`, (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        key: WORK_ITEM_KEY,
        stateId: "state-review",
        assigneeId: null,
        resolvedAt: null,
        version: 2,
      },
    });
  });
  await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
  const trigger = page.getByTestId("work-item-state-control");

  // Escape from the note form returns focus to the status trigger.
  await trigger.click();
  await page.getByRole("menuitem", { name: /Review/ }).click();
  const note = page.getByLabel("Add a note for this move");
  await expect(note).toBeFocused();
  await page.waitForTimeout(300);
  await expect(note).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(note).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Keyboard only: open, choose the move, write the note and send it.
  await page.keyboard.press("ArrowDown");
  const review = page.getByRole("menuitem", { name: /Review/ });
  await expect(review).toBeVisible();
  if (!(await review.evaluate((element) => element === document.activeElement)))
    await page.keyboard.press("ArrowDown");
  await expect(review).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(note).toBeFocused();
  await page.waitForTimeout(300);
  await expect(note).toBeFocused();
  await page.keyboard.type("Ready for review");
  await page.getByRole("button", { name: "Move" }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({
    toStateTemplateId: "template-review",
    note: "Ready for review",
  });
});

test("Escape in a create-dialog picker closes only the picker and keeps the draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPerformanceApiFixture(page);
  await page.goto(WORK_LIST_PATH);
  await page.getByTestId("create-work-item-trigger").click();
  const dialog = page.getByRole("dialog");
  const title = page.getByTestId("create-work-item-title");
  await title.fill("Draft kept across Escape");
  const priority = page.getByTestId("create-work-item-priority-trigger");
  await priority.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(title).toHaveValue("Draft kept across Escape");
  await expect(priority).toBeFocused();
});
