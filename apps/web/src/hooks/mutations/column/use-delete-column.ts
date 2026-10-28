import { useMutation } from "@tanstack/react-query";
import deleteColumn from "@/fetchers/column/delete-column";

/** Requests column deletion (`202` pending action); the column is kept until approval. */
export function useDeleteColumn() {
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId: string }) => deleteColumn(id),
  });
}
