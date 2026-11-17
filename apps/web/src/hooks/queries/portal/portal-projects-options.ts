import {
  getPortalProjects,
  portalProjectKeys,
} from "@/fetchers/portal/projects";

export function portalProjectsOptions(portalUserId: string) {
  return {
    queryKey: portalProjectKeys.list(portalUserId),
    queryFn: getPortalProjects,
    retry: false,
  };
}
