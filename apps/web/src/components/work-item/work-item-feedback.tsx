import { createContext, type ReactNode, useContext, useState } from "react";

type WorkItemFeedback = {
  /** Polite, visually hidden announcement of a successful change (WCAG 4.1.3). */
  announce: (message: string) => void;
  /** A save answered 409: the Properties column shows the inline "reload latest" alert. */
  conflict: boolean;
  reportConflict: () => void;
  clearConflict: () => void;
};

const WorkItemFeedbackContext = createContext<WorkItemFeedback | null>(null);

const NO_FEEDBACK: WorkItemFeedback = {
  announce: () => {},
  conflict: false,
  reportConflict: () => {},
  clearConflict: () => {},
};

/**
 * What the title, description and property rows share about saving one work item: one
 * live region for success announcements (mounted before any change, so the message is
 * read), and whether a save hit a version conflict.
 */
export function WorkItemFeedbackProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [announcement, setAnnouncement] = useState("");
  const [conflict, setConflict] = useState(false);
  return (
    <WorkItemFeedbackContext.Provider
      value={{
        announce: setAnnouncement,
        conflict,
        reportConflict: () => setConflict(true),
        clearConflict: () => setConflict(false),
      }}
    >
      <p role="status" className="sr-only" data-testid="work-item-status">
        {announcement}
      </p>
      {children}
    </WorkItemFeedbackContext.Provider>
  );
}

export function useWorkItemFeedback() {
  return useContext(WorkItemFeedbackContext) ?? NO_FEEDBACK;
}

export function useHasWorkItemFeedback() {
  return useContext(WorkItemFeedbackContext) !== null;
}
