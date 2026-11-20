import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

const src = join(import.meta.dirname, "..");
const R = "routes/agent/_layout/_authenticated/dashboard/settings";
// Every writer of audited settings must declare meta.audits so the controller withdraws History.
const AUDITED = [
  "components/account/canonical-mention-preference.tsx",
  "components/account/notification-preferences-settings.tsx",
  "components/account/portal-canonical-preferences.tsx",
  "components/account/quiet-hours-preference.tsx",
  "components/agile/estimate-settings.tsx",
  "components/automation/automation-rules-panel.tsx",
  "components/god-mode/instance-settings-form.tsx",
  "components/god-mode/notification-provider-editor.tsx",
  "components/god-mode/s3-draft-panel.tsx",
  "components/pending-action/pending-action-approval.tsx",
  "components/project/project-engagement-settings.tsx",
  "components/settings/create-service-key-dialog.tsx",
  "components/settings/service-keys-card.tsx",
  "components/settings/terminology-editor.tsx",
  "components/settings/workspace-project-defaults-panel.tsx",
  "components/time-tracking/time-activities-settings.tsx",
  "components/time-tracking/time-settings.tsx",
  "components/workflow/cab-template-panel.tsx",
  "hooks/mutations/api-key/use-create-api-key.ts",
  "hooks/mutations/api-key/use-revoke-api-key.ts",
  "hooks/mutations/notification-preferences/use-notification-preferences.ts",
  "hooks/mutations/project-member/use-project-member-mutations.ts",
  "hooks/mutations/project/use-update-project.ts",
  "hooks/mutations/use-change-password.ts",
  "hooks/mutations/use-remove-user-avatar.ts",
  "hooks/mutations/use-update-user-avatar.ts",
  "hooks/mutations/use-update-user-profile.ts",
  "hooks/mutations/user-settings/use-patch-user-settings.ts",
  "hooks/mutations/workspace-user/use-update-workspace-user-role.ts",
  "hooks/mutations/workspace/use-update-workspace.ts",
  "hooks/use-locale.ts",
  "hooks/use-project-view-preference.ts",
  `${R}/account/security.tsx`,
  `${R}/workspace/canned-responses.tsx`,
  `${R}/workspace/workflows.tsx`,
  "routes/portal/account.tsx",
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

it.each(AUDITED)("%s declares meta.audits", (file) => {
  expect(readFileSync(join(src, file), "utf8")).toMatch(/audits:\s*\{/);
});

it("only the History controller imports the raw History fetchers", () => {
  const allowed = new Set([
    "components/settings/settings-history.tsx", // type-only import
    "hooks/queries/settings/use-settings-history.ts",
    "query-client/settings-history-key.ts",
  ]);
  const offenders = walk(src)
    .map((f) => relative(src, f))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => !allowed.has(f))
    .filter((f) =>
      /fetchers\/settings\/(settings|personal)-history"/.test(
        readFileSync(join(src, f), "utf8"),
      ),
    );
  expect(offenders).toEqual([]);
});
