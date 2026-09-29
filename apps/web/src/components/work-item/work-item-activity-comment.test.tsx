import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkItemActivityComment from "./work-item-activity-comment";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
});

describe("WorkItemActivityComment", () => {
  it("renders persisted work-item link nodes from submitted comments", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <WorkItemActivityComment
          body={{
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Related: " },
                  {
                    type: "taskdeskIssueLink",
                    attrs: {
                      url: "https://example.test/work-items/PROJ-42",
                      issueKey: "PROJ-42",
                      taskId: "",
                    },
                  },
                ],
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "https://example.test/work-items/PROJ-42",
    );
    expect(link).toHaveTextContent("PROJ-42");
  });

  it("strips unsafe stored links while preserving comment text", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <WorkItemActivityComment
          body={{
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "script link",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: "javascript:alert(document.domain)" },
                      },
                    ],
                  },
                  {
                    type: "taskdeskIssueLink",
                    attrs: {
                      url: "//attacker.example/path",
                      issueKey: "EVIL-1",
                      taskId: "",
                    },
                  },
                ],
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("script link")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
