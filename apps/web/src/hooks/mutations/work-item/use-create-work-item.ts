import { useMutation } from "@tanstack/react-query";
import createWorkItem, {
  type CreateWorkItemInput,
} from "@/fetchers/work-item/create-work-item";

function useCreateWorkItem(input: CreateWorkItemInput) {
  return useMutation({
    mutationFn: () => createWorkItem(input),
  });
}

export default useCreateWorkItem;
