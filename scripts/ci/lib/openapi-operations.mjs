const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
]);

export function operationsOf(document) {
  const operations = new Set();
  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of Object.keys(pathItem ?? {})) {
      if (HTTP_METHODS.has(method.toLowerCase())) {
        operations.add(`${method.toUpperCase()} ${route}`);
      }
    }
  }
  return operations;
}
