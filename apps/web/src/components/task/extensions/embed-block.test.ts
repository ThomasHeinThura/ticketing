import { getSchema } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  EmbedBlock,
  getYouTubeEmbedSource,
  YOUTUBE_IFRAME_SANDBOX,
} from "./embed-block";

describe("restricted YouTube embeds", () => {
  it("accepts only canonical HTTPS YouTube hosts and 11-character video ids", () => {
    const id = "aB_123xyz-9";
    expect(getYouTubeEmbedSource(`https://youtu.be/${id}`)).toBe(
      `https://www.youtube.com/embed/${id}`,
    );
    expect(getYouTubeEmbedSource(`https://youtube.com/watch?v=${id}`)).toBe(
      `https://www.youtube.com/embed/${id}`,
    );
    expect(getYouTubeEmbedSource(`https://m.youtube.com/shorts/${id}`)).toBe(
      `https://www.youtube.com/embed/${id}`,
    );
    expect(getYouTubeEmbedSource(`https://youtube.com/live/${id}`)).toBe(
      `https://www.youtube.com/embed/${id}`,
    );

    for (const url of [
      "http://youtube.com/watch?v=aB_123xyz-9",
      "https://youtube.com.evil.test/watch?v=aB_123xyz-9",
      "https://youtube.com:8443/watch?v=aB_123xyz-9",
      "https://youtube.com/watch?v=abcdefghij",
      "https://youtube.com/watch?v=abcdefghijkl",
      "https://youtube.com/watch?v=abcdefghij!",
      "https://youtube.com/watch?v=aB_123xyz-9&v=anotherVideo",
      "https://youtu.be/aB_123xyz-9/extra",
      "https://youtube.com/embed/aB_123xyz-9",
    ]) {
      expect(getYouTubeEmbedSource(url)).toBeNull();
    }
  });

  it("keeps the iframe sandbox limited to the approved player capabilities", () => {
    expect(YOUTUBE_IFRAME_SANDBOX).toBe(
      "allow-scripts allow-same-origin allow-presentation",
    );
    expect(YOUTUBE_IFRAME_SANDBOX).not.toMatch(
      /allow-(?:forms|popups|top-navigation)/,
    );

    const schema = getSchema([StarterKit, EmbedBlock]);
    const node = schema.nodes.embedBlock.create({
      url: "https://youtu.be/aB_123xyz-9",
      mode: "embed",
    });
    const rendered = DOMSerializer.fromSchema(schema).serializeNode(node);
    if (!(rendered instanceof HTMLElement)) {
      throw new Error("EmbedBlock did not render an HTML element");
    }
    const iframe = rendered.querySelector("iframe");
    expect(iframe).toHaveAttribute("sandbox", YOUTUBE_IFRAME_SANDBOX);
    expect(iframe).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/aB_123xyz-9",
    );
  });
});
