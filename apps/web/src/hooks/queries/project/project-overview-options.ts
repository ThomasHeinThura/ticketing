import {
  getProjectOverview,
  projectOverviewKeys,
} from "@/fetchers/project/overview-read";

export function projectOverviewOptions(id: string) {
  return {
    queryKey: projectOverviewKeys.overview(id),
    queryFn: () => getProjectOverview(id),
  };
}
