import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import NotificationEmail from "./notification";

describe("NotificationEmail", () => {
  it("renders Japanese chrome for a Japanese locale", async () => {
    const html = await render(
      createElement(NotificationEmail, {
        title: "タスクが割り当てられました",
        message: "デザイン案の確認をお願いします。",
        actionUrl: "https://taskdesk.example/task/1",
        locale: "ja-JP",
        preferenceUrl:
          "https://taskdesk.example/dashboard/settings/account/notifications#preference_token=synthetic",
      }),
    );
    expect(html).toContain("TaskDesk で開く");
    expect(html).toContain("通知設定");
    expect(html).toContain("#preference_token=synthetic");
    expect(html).toContain("配信設定に一致する通知がありました。");
  });
});
