import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const e2eDirectory = dirname(fileURLToPath(import.meta.url));

export default {
  testDir: e2eDirectory,
  testMatch:
    /(approvals-primary-journey|customer-cannot-request-cab|requester-cannot-self-approve|approver-email-not-leaked|users-primary-journey|service-operations-primary-journey|intake-primary-journey|session-cache-security-journey|portal-projects-journey|portal-request-conversation-journey|storage-probe-retention-journey|portal-submission-upload-binding|s3-draft-settings-journey|bootstrap-pending-session-journey)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  outputDir: resolve(e2eDirectory, "../../test-results/approvals-e2e"),
  use: {
    trace: "off",
    screenshot: "off",
    video: "off",
  },
};
