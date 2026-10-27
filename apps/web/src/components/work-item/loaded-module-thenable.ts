/**
 * A thenable that settles synchronously with an already loaded module. `React.lazy` reads such
 * a loader's result in the same render instead of suspending for a microtask, which would
 * commit the boundary's fallback first and then remount its content.
 */
export function loadedModuleThenable<T>(module: T): Promise<T> {
  const thenable = {
    // biome-ignore lint/suspicious/noThenProperty: a synchronous thenable for React.lazy
    then: (resolve: (value: T) => void) => resolve(module),
  };
  return thenable as unknown as Promise<T>;
}
