import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  Navigate: () => null,
  Outlet: () => null,
  useLocation: () => ({ pathname: "/agent" }),
  useNavigate: () => vi.fn(),
}));

import { agentSectionTitleKey } from "./agent";

describe("agent breadcrumb page names", () => {
  it.each([
    ["/agent/kb", "navigation:sidebar.knowledgeBase"],
    ["/agent/kb/abc", "navigation:sidebar.knowledgeBase"],
    ["/agent/reports", "navigation:sidebar.reports"],
    ["/agent/reports/new", "navigation:sidebar.reports"],
    ["/agent/timesheet", "navigation:sidebar.timesheet"],
    ["/agent/dashboard", "navigation:sidebar.dashboard"],
    ["/agent/inbox", "navigation:sidebar.inbox"],
    ["/agent/my-work", "navigation:sidebar.myWork"],
    ["/agent/triage", "navigation:sidebar.triage"],
    ["/agent/views", "navigation:sidebar.savedViews"],
    [
      "/agent/service-management/services",
      "navigation:sidebar.serviceManagement",
    ],
  ])("%s -> %s", (path, key) => {
    expect(agentSectionTitleKey(path)).toBe(key);
  });
});
