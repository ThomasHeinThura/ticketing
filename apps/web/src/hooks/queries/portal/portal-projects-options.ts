import {
  getPortalProjects,
  portalProjectKeys,
} from "@/fetchers/portal/projects";

export function portalProjectsOptions() {
  return {
    queryKey: portalProjectKeys.list(),
    queryFn: getPortalProjects,
    retry: false,
  };
}
