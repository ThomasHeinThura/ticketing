import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ canManage: false }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: { projectKey?: string; projectId?: string };
    children?: React.ReactNode;
  }) => (
    <a
      {...props}
      href={to
        .replace("$projectKey", params?.projectKey ?? "")
        .replace("$projectId", params?.projectId ?? "")}
    >
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./use-can-manage-project-features", () => ({
  useCanManageProjectFeatures: () => state.canManage,
  useCanManageProjectFeaturesById: () => state.canManage,
}));

import {
  FeatureOff,
  ProjectFeatureOff,
  ProjectIdFeatureOff,
} from "./feature-off";

afterEach(() => {
  cleanup();
  state.canManage = false;
});

describe("FeatureOff (UX-1a, W-08/PH-09)", () => {
  it("is the shared off state: decorative icon, title and copy, no action by default", () => {
    const { container } = render(<FeatureOff feature="estimates" />);
    expect(screen.getByTestId("feature-off-estimates")).toBeInTheDocument();
    expect(screen.getByText("featureOff.estimates.title")).toBeInTheDocument();
    expect(
      screen.getByText("featureOff.estimates.description"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-slot=empty-media][aria-hidden=true] svg"),
    ).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it.each([
    "cycles",
    "modules",
    "estimates",
    "calendar",
    "timeline",
    "pages",
  ] as const)(
    "offers Open feature settings for %s only to someone who can manage the project",
    (feature) => {
      render(<ProjectFeatureOff feature={feature} projectKey="HELP" />);
      expect(
        screen.getByText(`featureOff.${feature}.description`),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      cleanup();

      state.canManage = true;
      render(<ProjectFeatureOff feature={feature} projectKey="HELP" />);
      expect(
        screen.getByText(`featureOff.${feature}.manageDescription`),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "featureOff.openSettings" }),
      ).toHaveAttribute("href", "/agent/projects/HELP/settings/features");
    },
  );

  it.each(["calendar", "timeline"] as const)(
    "opens the id-based feature settings from the Kaneo %s view, only for a project settings manager",
    (feature) => {
      render(
        <ProjectIdFeatureOff
          feature={feature}
          projectId="p1"
          workspaceId="w1"
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      cleanup();

      state.canManage = true;
      render(
        <ProjectIdFeatureOff
          feature={feature}
          projectId="p1"
          workspaceId="w1"
        />,
      );
      expect(
        screen.getByText(`featureOff.${feature}.manageDescription`),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "featureOff.openSettings" }),
      ).toHaveAttribute("href", "/dashboard/settings/projects/p1/features");
    },
  );
});
