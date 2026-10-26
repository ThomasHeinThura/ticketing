import { useQuery } from "@tanstack/react-query";
import { getCycles, getModules } from "@/fetchers/agile";
import { getCustomFields } from "@/fetchers/custom-field";
import type { EngineRun, MappingDomain } from "@/fetchers/god-mode/imports";
import { getProjectLabels } from "@/fetchers/label/project-labels";
import getProjects from "@/fetchers/project/get-projects";
import getAssignablePeople from "@/fetchers/work-item/get-assignable-people";
import getWorkItemTypes from "@/fetchers/work-item/get-work-item-types";
import type { TargetCatalogue } from "./wizard-model";

/**
 * Target choices the mapping pickers offer, loaded only for the domains the run actually has.
 * `failed` lists domains whose catalogue could not be loaded so the UI can say so instead of
 * silently offering fewer targets.
 */
export function useTargetCatalogue(
  run: Pick<EngineRun, "workspaceId" | "projectId">,
  domains: ReadonlySet<MappingDomain>,
): { catalogue: TargetCatalogue; failed: MappingDomain[]; loading: boolean } {
  const { workspaceId, projectId } = run;
  const key = (name: string) =>
    ["god-mode", "imports", "targets", name, workspaceId, projectId] as const;
  const types = useQuery({
    queryKey: key("type"),
    queryFn: () => getWorkItemTypes(workspaceId),
    enabled: domains.has("type"),
    retry: false,
  });
  const people = useQuery({
    queryKey: key("person"),
    queryFn: () => getAssignablePeople(projectId ?? ""),
    enabled: domains.has("person") && Boolean(projectId),
    retry: false,
  });
  const labels = useQuery({
    queryKey: key("label"),
    queryFn: () => getProjectLabels(projectId ?? ""),
    enabled: domains.has("label") && Boolean(projectId),
    retry: false,
  });
  const fields = useQuery({
    queryKey: key("custom_field"),
    queryFn: () => getCustomFields(workspaceId),
    enabled: domains.has("custom_field"),
    retry: false,
  });
  const needsProjects =
    domains.has("project") || domains.has("cycle") || domains.has("module");
  const projects = useQuery({
    queryKey: key("project"),
    queryFn: () => getProjects({ workspaceId }),
    enabled: needsProjects,
    retry: false,
  });
  const slug = (projects.data ?? []).find((p) => p.id === projectId)?.slug;
  const cycles = useQuery({
    queryKey: key("cycle"),
    queryFn: () => getCycles(slug ?? ""),
    enabled: domains.has("cycle") && Boolean(slug),
    retry: false,
  });
  const modules = useQuery({
    queryKey: key("module"),
    queryFn: () => getModules(slug ?? ""),
    enabled: domains.has("module") && Boolean(slug),
    retry: false,
  });

  const catalogue: TargetCatalogue = {
    type: (types.data ?? []).map((row) => ({ id: row.id, name: row.name })),
    person: (people.data ?? []).map((row) => ({
      id: row.personId,
      name: row.name ?? row.personId,
    })),
    label: ((labels.data ?? []) as { id: string; name: string }[]).map(
      (row) => ({ id: row.id, name: row.name }),
    ),
    custom_field: (fields.data?.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    project: (projects.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    cycle: (cycles.data?.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    module: (modules.data?.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
  };
  const failed: MappingDomain[] = [];
  if (types.isError) failed.push("type");
  if (people.isError) failed.push("person");
  if (labels.isError) failed.push("label");
  if (fields.isError) failed.push("custom_field");
  if (projects.isError) failed.push("project");
  if (cycles.isError) failed.push("cycle");
  if (modules.isError) failed.push("module");
  const loading = [
    types,
    people,
    labels,
    fields,
    projects,
    cycles,
    modules,
  ].some((q) => q.isFetching);
  return { catalogue, failed, loading };
}
