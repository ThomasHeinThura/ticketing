/**
 * jsdom does no layout, so Range and Text lack getClientRects/getBoundingClientRect.
 * ProseMirror measures them when an editor takes focus or a transaction calls
 * scrollIntoView (Tiptap does this asynchronously), which otherwise raises an
 * intermittent "target.getClientRects is not a function" unhandled error whenever a
 * test's timers outlive its assertions. Install zero-size layout only where jsdom
 * has none; real implementations are never replaced.
 */
export function installJSDOMLayoutStubs(target: {
  Range: { prototype: object };
  Text: { prototype: object };
}) {
  const zeroRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  };
  for (const proto of [target.Range.prototype, target.Text.prototype]) {
    if (!("getClientRects" in proto)) {
      Object.defineProperty(proto, "getClientRects", {
        configurable: true,
        writable: true,
        value: () => [],
      });
    }
    if (!("getBoundingClientRect" in proto)) {
      Object.defineProperty(proto, "getBoundingClientRect", {
        configurable: true,
        writable: true,
        value: () => zeroRect,
      });
    }
  }
}
