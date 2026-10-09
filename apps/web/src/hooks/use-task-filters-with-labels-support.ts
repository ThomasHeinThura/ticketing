import { useCallback, useMemo } from "react";
import { filterProjectTasks } from "@/lib/filter-project-tasks";
import type { BoardFilters } from "@/lib/project-board-search";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";

export function useTaskFiltersWithLabelsSupport(
  project: ProjectWithTasks | null | undefined,
  filters: BoardFilters,
  textQuery: string | undefined,
  onFiltersChange: (filters: BoardFilters) => void,
) {
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const hasActiveFilters = Object.values(filters).some(
    (filter) => filter !== null && filter.length > 0,
  );

  const filterTasks = useCallback(
    <T extends ProjectWithTasks["columns"][number]["tasks"][number]>(
      tasks: T[],
    ) =>
      filterProjectTasks(tasks, {
        filters,
        query: textQuery,
        projectSlug: project?.slug,
        weekStartsOn,
      }),
    [filters, project?.slug, textQuery, weekStartsOn],
  );

  const filteredProject = useMemo(() => {
    if (!project) return null;
    if (!hasActiveFilters && !textQuery?.trim()) return project;
    return {
      ...project,
      columns:
        project.columns?.map((column) => ({
          ...column,
          tasks: filterTasks(column.tasks),
        })) ?? [],
    };
  }, [project, filterTasks, hasActiveFilters, textQuery]);

  const clearFilters = useCallback(() => {
    onFiltersChange({
      status: null,
      priority: null,
      assignee: null,
      dueDate: null,
      labels: null,
    });
  }, [onFiltersChange]);

  const updateFilter = useCallback(
    (key: keyof BoardFilters, value: BoardFilters[keyof BoardFilters]) => {
      onFiltersChange({ ...filters, [key]: value });
    },
    [filters, onFiltersChange],
  );

  const updateLabelFilter = useCallback(
    (labelId: string) => {
      const currentLabels = filters.labels ?? [];
      const nextLabels = currentLabels.includes(labelId)
        ? currentLabels.filter((id) => id !== labelId)
        : [...currentLabels, labelId];
      onFiltersChange({
        ...filters,
        labels: nextLabels.length ? nextLabels : null,
      });
    },
    [filters, onFiltersChange],
  );

  return {
    filters,
    updateFilter,
    updateLabelFilter,
    filteredProject,
    hasActiveFilters,
    clearFilters,
  };
}
