import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseOptionalStringSearch } from "@/lib/optional-string-search";

// Preserve the sign-in URL used by older local SIT documentation and bookmarks.
export const Route = createFileRoute("/agent/sign-in")({
  validateSearch: (search: Record<string, unknown>) =>
    parseOptionalStringSearch(search, [
      "invitationId",
      "email",
      "redirect",
      "error",
    ]),
  beforeLoad: ({ search }) => {
    const destination = search.redirect;
    throw redirect({
      to: "/auth/sign-in",
      search: {
        ...search,
        redirect:
          destination?.startsWith("/") &&
          !destination.includes("//") &&
          !destination.startsWith("/agent/sign-in")
            ? destination
            : "/agent",
      },
      replace: true,
    });
  },
});
