/**
 * `PR-17` / `WF-2`: "A project may not create a concrete state for a template with no
 * outbound transition anywhere in the workflows its types use." A transition with a null
 * `from_state_template_id` matches ANY template (`WF-5`), so its presence gives every
 * template an outbound transition.
 *
 * Pure: the repository supplies the `from` template ids of every transition in the active
 * version of every workflow a workspace work-item type uses.
 */
export function templateHasOutboundTransition(
  templateId: string,
  fromTemplateIds: ReadonlyArray<string | null>,
): boolean {
  return fromTemplateIds.some((from) => from === null || from === templateId);
}

/**
 * New position of the moved state after re-ordering `orderedIds` (current order, active
 * states only), clamped into range. Returns the full new order.
 */
export function moveStateToPosition(
  orderedIds: readonly string[],
  stateId: string,
  position: number,
): string[] | null {
  const index = orderedIds.indexOf(stateId);
  if (index === -1) return null;
  const next = orderedIds.filter((id) => id !== stateId);
  const target = Math.max(0, Math.min(position, next.length));
  next.splice(target, 0, stateId);
  return next;
}
