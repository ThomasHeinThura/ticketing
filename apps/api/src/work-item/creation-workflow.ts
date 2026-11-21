export function canLeaveDefaultState(
  defaultTemplateId: string,
  projectTemplateIds: Set<string>,
  liveTemplateIds: Set<string>,
  edges: Array<{
    fromStateTemplateId: string | null;
    toStateTemplateId: string;
  }>,
) {
  return (
    liveTemplateIds.has(defaultTemplateId) &&
    edges.some(
      (edge) =>
        (edge.fromStateTemplateId === null ||
          edge.fromStateTemplateId === defaultTemplateId) &&
        edge.toStateTemplateId !== defaultTemplateId &&
        liveTemplateIds.has(edge.toStateTemplateId) &&
        projectTemplateIds.has(edge.toStateTemplateId),
    )
  );
}
