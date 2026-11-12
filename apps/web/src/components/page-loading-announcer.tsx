import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

const LoadingContext = createContext<(() => () => void) | null>(null);

/** One live region survives router remounts; a brief handoff between placeholders is one load. */
export function PageLoadingAnnouncer({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const count = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(clearTimer.current), []);
  const register = useCallback(() => {
    clearTimeout(clearTimer.current);
    count.current += 1;
    setLoading(true);
    return () => {
      count.current -= 1;
      if (count.current === 0)
        clearTimer.current = setTimeout(() => setLoading(false), 150);
    };
  }, []);
  return (
    <LoadingContext.Provider value={register}>
      {children}
      <span
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="loading-announcer"
      >
        {loading ? t("common:pageLoading") : ""}
      </span>
    </LoadingContext.Provider>
  );
}

export function usePageLoadingAnnouncement() {
  const register = useContext(LoadingContext);
  useEffect(() => register?.(), [register]);
}
