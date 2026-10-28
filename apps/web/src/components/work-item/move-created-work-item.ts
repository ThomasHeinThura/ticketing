import getWorkItemTransitions from "@/fetchers/work-item/get-work-item-transitions";
import transitionWorkItem from "@/fetchers/work-item/transition-work-item";

export type MoveCreatedWorkItemResult = "already" | "moved" | "unavailable";

/**
 * Kaneo's per-column "+" (P1R2-2): a new item always starts in the project's default state
 * (`WI-4`), so creating it from another column moves it there with the workflow transition a
 * drop onto that column would use. A transition the workflow does not offer, or one that
 * needs a note, leaves the item in its initial state.
 */
export async function moveCreatedWorkItemToState(input: {
  key: string;
  currentStateId: string | null | undefined;
  targetStateId: string;
}): Promise<MoveCreatedWorkItemResult> {
  if (input.currentStateId === input.targetStateId) return "already";
  const offers = await getWorkItemTransitions(input.key);
  const offer = offers.find(
    (candidate) => candidate.toStateId === input.targetStateId,
  );
  if (!offer?.available || offer.notePolicy === "required")
    return "unavailable";
  await transitionWorkItem({
    key: input.key,
    toStateTemplateId: offer.toStateTemplateId,
  });
  return "moved";
}
