import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export function getModifierKeyText(): string {
  if (typeof window === "undefined") return "";
  return navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";
}

type ShortcutHandler = () => void;
type ShortcutKey = string;
type PrefixKey = string;
type SequentialKey = string;

type KeyboardShortcutsContextType = {
  registerShortcut: (key: ShortcutKey, handler: ShortcutHandler) => void;
  registerSequentialShortcut: (
    prefix: PrefixKey,
    key: SequentialKey,
    handler: ShortcutHandler,
  ) => void;
  registerModifierShortcut: (
    modifierKey: string,
    key: string,
    handler: ShortcutHandler,
  ) => void;
  unregisterShortcut: (key: ShortcutKey) => void;
  unregisterSequentialShortcut: (prefix: PrefixKey, key: SequentialKey) => void;
  unregisterModifierShortcut: (modifierKey: string, key: string) => void;
  activePrefix: string | null;
};

const KeyboardShortcutsContext =
  createContext<KeyboardShortcutsContextType | null>(null);

export function useKeyboardShortcuts() {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error(
      "useKeyboardShortcuts must be used within a KeyboardShortcutsProvider",
    );
  }
  return context;
}

export function KeyboardShortcutsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // #407: these three registries used to be `useState`, so every
  // register/unregister call was a real state change that re-rendered this
  // Provider. That recreated the inline context `value` below, which
  // re-rendered every consumer (including whichever one just registered),
  // which rebuilt its own shortcutsConfig object, which re-ran
  // `useRegisterShortcuts`'s effect (keyed on that object's identity) --
  // register/unregister again, forever. None of these maps are ever read
  // during render, only inside the `keydown` handler below, so they don't
  // need to be React state at all -- a ref removes the state change (and
  // the loop) at its source instead of requiring every caller to memoize.
  const shortcutsRef = useRef<Map<string, ShortcutHandler>>(new Map());
  const sequentialShortcutsRef = useRef<
    Map<string, Map<string, ShortcutHandler>>
  >(new Map());
  const modifierShortcutsRef = useRef<Map<string, ShortcutHandler>>(new Map());
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  const [prefixTimeout, setPrefixTimeout] = useState<number | null>(null);

  const resetPrefix = useCallback(() => {
    setActivePrefix(null);
    if (prefixTimeout) {
      window.clearTimeout(prefixTimeout);
      setPrefixTimeout(null);
    }
  }, [prefixTimeout]);

  const setPrefixWithTimeout = useCallback(
    (prefix: string) => {
      if (prefixTimeout) {
        window.clearTimeout(prefixTimeout);
      }

      setActivePrefix(prefix);

      const timeout = window.setTimeout(() => {
        setActivePrefix(null);
        setPrefixTimeout(null);
      }, 2000);

      setPrefixTimeout(timeout);
    },
    [prefixTimeout],
  );

  const registerShortcut = useCallback(
    (key: string, handler: ShortcutHandler) => {
      shortcutsRef.current.set(key, handler);
    },
    [],
  );

  const registerSequentialShortcut = useCallback(
    (prefix: string, key: string, handler: ShortcutHandler) => {
      if (!sequentialShortcutsRef.current.has(prefix)) {
        sequentialShortcutsRef.current.set(prefix, new Map());
      }
      sequentialShortcutsRef.current.get(prefix)?.set(key, handler);
    },
    [],
  );

  const registerModifierShortcut = useCallback(
    (modifierKey: string, key: string, handler: ShortcutHandler) => {
      const shortcutKey = `${modifierKey}+${key.toLowerCase()}`;
      modifierShortcutsRef.current.set(shortcutKey, handler);
    },
    [],
  );

  const unregisterShortcut = useCallback((key: string) => {
    shortcutsRef.current.delete(key);
  }, []);

  const unregisterSequentialShortcut = useCallback(
    (prefix: string, key: string) => {
      const prefixMap = sequentialShortcutsRef.current.get(prefix);
      if (!prefixMap) return;
      prefixMap.delete(key);
      if (prefixMap.size === 0) {
        sequentialShortcutsRef.current.delete(prefix);
      }
    },
    [],
  );

  const unregisterModifierShortcut = useCallback(
    (modifierKey: string, key: string) => {
      const shortcutKey = `${modifierKey}+${key.toLowerCase()}`;
      modifierShortcutsRef.current.delete(shortcutKey);
    },
    [],
  );

  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isEditingText =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true";
      if (isEditingText && !event.metaKey && !event.ctrlKey) {
        return;
      }

      const key = event.key.toLowerCase();

      // Editors own their chords (cmd+b bold in TipTap and friends); only
      // the palette toggle may pass while typing.
      if (isEditingText && (key !== "k" || event.altKey || event.shiftKey)) {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        const modifierKey = event.metaKey
          ? "⌘"
          : event.ctrlKey
            ? "Ctrl"
            : event.altKey
              ? "Alt"
              : "Shift";
        const shortcutKey = `${modifierKey}+${key}`;

        const handler = modifierShortcutsRef.current.get(shortcutKey);
        if (handler) {
          event.preventDefault();
          handler();
        }
        return;
      }

      if (activePrefix) {
        const prefixMap = sequentialShortcutsRef.current.get(activePrefix);
        const handler = prefixMap?.get(key);
        if (handler) {
          event.preventDefault();
          handler();
          resetPrefix();
          return;
        }
      }

      const handler = shortcutsRef.current.get(key);
      if (handler) {
        event.preventDefault();
        handler();
      } else if (sequentialShortcutsRef.current.has(key)) {
        event.preventDefault();
        setPrefixWithTimeout(key);
      }
    },
    // shortcutsRef/sequentialShortcutsRef/modifierShortcutsRef are refs (stable
    // identity, read fresh on every call) so they don't belong in this list.
    [activePrefix, resetPrefix, setPrefixWithTimeout],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyPress);
    return () => {
      document.removeEventListener("keydown", handleKeyPress);
      if (prefixTimeout) {
        window.clearTimeout(prefixTimeout);
      }
    };
  }, [handleKeyPress, prefixTimeout]);

  useEffect(() => {
    return () => {
      if (prefixTimeout) {
        window.clearTimeout(prefixTimeout);
      }
    };
  }, [prefixTimeout]);

  // All six register/unregister callbacks are `useCallback(..., [])`, so
  // this only actually changes when `activePrefix` does -- consumers that
  // don't care about `activePrefix` (nearly all of them; see the registries
  // above) now see a stable context value across unrelated renders instead
  // of a fresh object every time.
  const value = useMemo(
    () => ({
      registerShortcut,
      registerSequentialShortcut,
      registerModifierShortcut,
      unregisterShortcut,
      unregisterSequentialShortcut,
      unregisterModifierShortcut,
      activePrefix,
    }),
    [
      registerShortcut,
      registerSequentialShortcut,
      registerModifierShortcut,
      unregisterShortcut,
      unregisterSequentialShortcut,
      unregisterModifierShortcut,
      activePrefix,
    ],
  );

  return React.createElement(
    KeyboardShortcutsContext.Provider,
    { value },
    children,
  );
}

export function useRegisterShortcuts(shortcutsConfig: {
  shortcuts?: { [key: string]: ShortcutHandler };
  sequentialShortcuts?: {
    [prefix: string]: { [key: string]: ShortcutHandler };
  };
  modifierShortcuts?: {
    [modifierKey: string]: { [key: string]: ShortcutHandler };
  };
}) {
  const {
    registerShortcut,
    registerSequentialShortcut,
    registerModifierShortcut,
    unregisterShortcut,
    unregisterSequentialShortcut,
    unregisterModifierShortcut,
  } = useKeyboardShortcuts();

  useEffect(() => {
    if (shortcutsConfig.shortcuts) {
      for (const [key, handler] of Object.entries(shortcutsConfig.shortcuts)) {
        registerShortcut(key, handler);
      }
    }

    if (shortcutsConfig.sequentialShortcuts) {
      for (const [prefix, prefixMap] of Object.entries(
        shortcutsConfig.sequentialShortcuts,
      )) {
        for (const [key, handler] of Object.entries(prefixMap)) {
          registerSequentialShortcut(prefix, key, handler);
        }
      }
    }

    if (shortcutsConfig.modifierShortcuts) {
      for (const [modifierKey, keyMap] of Object.entries(
        shortcutsConfig.modifierShortcuts,
      )) {
        for (const [key, handler] of Object.entries(keyMap)) {
          registerModifierShortcut(modifierKey, key, handler);
        }
      }
    }

    return () => {
      if (shortcutsConfig.shortcuts) {
        for (const key of Object.keys(shortcutsConfig.shortcuts)) {
          unregisterShortcut(key);
        }
      }

      if (shortcutsConfig.sequentialShortcuts) {
        for (const [prefix, prefixMap] of Object.entries(
          shortcutsConfig.sequentialShortcuts,
        )) {
          for (const key of Object.keys(prefixMap)) {
            unregisterSequentialShortcut(prefix, key);
          }
        }
      }

      if (shortcutsConfig.modifierShortcuts) {
        for (const [modifierKey, keyMap] of Object.entries(
          shortcutsConfig.modifierShortcuts,
        )) {
          for (const key of Object.keys(keyMap)) {
            unregisterModifierShortcut(modifierKey, key);
          }
        }
      }
    };
  }, [
    registerShortcut,
    registerSequentialShortcut,
    registerModifierShortcut,
    unregisterShortcut,
    unregisterSequentialShortcut,
    unregisterModifierShortcut,
    shortcutsConfig,
  ]);
}
