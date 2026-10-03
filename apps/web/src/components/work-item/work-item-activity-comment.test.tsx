import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkItemActivityComment from "./work-item-activity-comment";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
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

  it("renders comment images only from the configured TaskDesk asset route", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.taskdesk.test");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WorkItemActivityComment
          body={{
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "image",
                    attrs: { src: "/api/asset/asset123", alt: "valid" },
                  },
                  {
                    type: "image",
                    attrs: {
                      src: "https://tracker.example/pixel.png",
                      alt: "external",
                    },
                  },
                ],
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole("img", { name: "valid" });
    expect(
      container.querySelector('img[src="https://tracker.example/pixel.png"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        'img[src="https://api.taskdesk.test/api/asset/asset123"]',
      ),
    ).toHaveAttribute("src", "https://api.taskdesk.test/api/asset/asset123");
  });

  it("renders stored attachment cards only through the protected TaskDesk asset route", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.taskdesk.test");
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
                    type: "attachmentCard",
                    attrs: {
                      url: "/api/asset/asset123",
                      filename: "report.pdf",
                      mimeType: "application/pdf",
                      size: 1024,
                    },
                  },
                  {
                    type: "attachmentCard",
                    attrs: {
                      url: "https://attacker.example/file.pdf",
                      filename: "hostile.pdf",
                    },
                  },
                ],
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("link", { name: "report.pdf" }),
    ).toHaveAttribute("href", "https://api.taskdesk.test/api/asset/asset123");
    expect(screen.getByText("hostile.pdf")).toBeInTheDocument();
    expect(screen.getByText("hostile.pdf").closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: "hostile.pdf" })).toBeNull();
  });

  it("renders Mermaid source with a translated inert fallback label", async () => {
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
                type: "codeBlock",
                attrs: { language: "mermaid" },
                content: [{ type: "text", text: "flowchart TD\nA-->B" }],
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("tasks:detail.editor.mermaid.renderFailed"),
    ).toBeInTheDocument();
    expect(screen.getByText("flowchart TD A-->B")).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("renders stored embeds as inert text and ignores unknown nodes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WorkItemActivityComment
          body={{
            type: "doc",
            content: [
              {
                type: "embedBlock",
                attrs: {
                  url: "https://attacker.example/embed?token=secret",
                  mode: "embed",
                },
              },
              {
                type: "unknownStoredNode",
                attrs: { url: "javascript:alert(1)" },
              },
            ],
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("tasks:detail.editor.embed.onlyYoutubeInline"),
    ).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      screen.queryByText(/attacker\.example|secret|javascript:/),
    ).toBeNull();
  });
});
