import { mergeAttributes, Node } from "@tiptap/core";
import { i18n } from "@/lib/i18n";
import { escapeHtml, isValidUrl } from "./url-safety";

type EmbedMode = "embed" | "link";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const YOUTUBE_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";

export function getYouTubeEmbedSource(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) {
      return null;
    }

    let videoId: string | null = null;
    if (host === "youtu.be") {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts.length === 1) videoId = pathParts[0] ?? null;
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (parsed.pathname === "/watch") {
        const values = parsed.searchParams.getAll("v");
        if (values.length === 1) videoId = values[0] ?? null;
      } else if (
        pathParts.length === 2 &&
        (pathParts[0] === "shorts" || pathParts[0] === "live")
      ) {
        videoId = pathParts[1] ?? null;
      }
    }
    if (videoId && YOUTUBE_VIDEO_ID.test(videoId)) {
      return `https://www.youtube.com/embed/${videoId}`;
    }
  } catch {
    return null;
  }

  return null;
}

export const EmbedBlock = Node.create({
  name: "embedBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      url: {
        default: "",
      },
      mode: {
        default: "embed",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "taskdesk-embed[url]",
      },
      {
        tag: "div[data-type='taskdesk-embed'][data-url]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const url = String(HTMLAttributes.url || "");
    const mode = String(HTMLAttributes.mode || "embed") as EmbedMode;
    const embedSource = mode === "embed" ? getYouTubeEmbedSource(url) : null;
    const attrs = mergeAttributes(HTMLAttributes, {
      "data-type": "taskdesk-embed",
      "data-url": url,
      "data-mode": mode,
      contenteditable: "false",
    });

    if (!isValidUrl(url)) {
      return [
        "div",
        attrs,
        ["span", { class: "taskdesk-embed-invalid-link" }, url],
      ];
    }

    if (embedSource) {
      return [
        "div",
        attrs,
        [
          "iframe",
          {
            src: embedSource,
            sandbox: YOUTUBE_IFRAME_SANDBOX,
            loading: "lazy",
            allow:
              "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
            allowfullscreen: "true",
            referrerpolicy: "strict-origin-when-cross-origin",
            title: i18n.t("tasks:detail.editor.embed.embeddedContent"),
          },
        ],
      ];
    }

    if (mode === "embed") {
      return [
        "div",
        attrs,
        [
          "div",
          { class: "taskdesk-embed-unsupported" },
          i18n.t("tasks:detail.editor.embed.onlyYoutubeInline"),
        ],
      ];
    }

    return [
      "div",
      attrs,
      [
        "a",
        {
          href: url,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
        url,
      ],
    ];
  },

  renderMarkdown(
    node: { attrs?: { url?: string; mode?: string } },
    _helpers: unknown,
    _context: unknown,
  ) {
    const url = String(node.attrs?.url || "");
    const mode = node.attrs?.mode === "link" ? "link" : "embed";
    if (!isValidUrl(url)) {
      return `\n<span class="taskdesk-embed-invalid-link">${escapeHtml(url)}</span>\n`;
    }
    return `\n<taskdesk-embed url="${escapeHtml(url)}" mode="${mode}" />\n`;
  },
});
