/**
 * The heading levels of a rendered page in document order (visually hidden headings included),
 * for asserting a composed screen's outline: every page has exactly one `h1`, and what sits under
 * it starts at `h2`. `[1]` is a page whose off state is the page; `[1, 2]` is an off state under
 * the page's own title.
 */
export function headingLevels(root: ParentNode = document.body): number[] {
  return Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(
    (heading) => Number(heading.tagName.slice(1)),
  );
}
