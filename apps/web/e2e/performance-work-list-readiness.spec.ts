import { expect, test } from "@playwright/test";
import {
  assertWorkListReadiness,
  waitForWorkListReadiness,
} from "./helpers/work-list-readiness";

const ready = `<div data-testid="work-item-list-populated"><button>Backlog 500</button><div data-virtual-item-id="1"><div data-task-id="1">Row</div><span data-testid="work-item-inline-assignee">Assignee</span></div></div>`;

test("LCP readiness requires the settled grouped list and first inline control", async ({
  page,
}) => {
  await test.step("settled list passes", async () => {
    await page.setContent(ready);
    await waitForWorkListReadiness(page, 300);
    await assertWorkListReadiness(page);
  });
  const cases: [string, string][] = [
    [
      "hidden list",
      ready.replace(
        '<div data-testid="work-item-list-populated">',
        '<div hidden data-testid="work-item-list-populated">',
      ),
    ],
    [
      "missing list",
      ready.replace(
        '<div data-testid="work-item-list-populated">',
        '<div data-testid="other">',
      ),
    ],
    [
      "hidden table",
      `${ready}<table hidden data-testid="work-item-list-populated"></table>`,
    ],
    [
      "visible table",
      `${ready}<table data-testid="work-item-list-populated"><tbody><tr><td>Interim</td></tr></tbody></table>`,
    ],
    [
      "two tables",
      `${ready}<table data-testid="work-item-list-populated"></table><table hidden data-testid="work-item-list-populated"></table>`,
    ],
    [
      "hidden backlog",
      ready.replace(
        "<button>Backlog 500</button>",
        "<button hidden>Backlog 500</button>",
      ),
    ],
    ["wrong backlog count", ready.replace("Backlog 500", "Backlog 499")],
    [
      "hidden row",
      ready.replace('<div data-task-id="1">', '<div hidden data-task-id="1">'),
    ],
    ["missing row", ready.replace(' data-task-id="1"', "")],
    [
      "hidden assignee",
      ready.replace(
        '<span data-testid="work-item-inline-assignee">',
        '<span hidden data-testid="work-item-inline-assignee">',
      ),
    ],
    [
      "missing assignee",
      ready.replace(
        'data-testid="work-item-inline-assignee"',
        'data-testid="other"',
      ),
    ],
  ];
  for (const [name, html] of cases) {
    await test.step(name, async () => {
      await page.setContent(html);
      await expect(waitForWorkListReadiness(page, 300)).rejects.toThrow();
    });
  }
});
