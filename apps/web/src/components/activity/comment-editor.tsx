import {
  Button,
  Dialog,
  DialogPopup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Kbd,
  KbdGroup,
} from "@taskdesk/ui";
import type { Editor, Extensions, JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  Check,
  ChevronDown,
  Code,
  Columns3,
  Copy,
  Grid2x2X,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Minus,
  Paperclip,
  Pilcrow,
  Rows3,
  SquareCode,
  Strikethrough,
  TableIcon,
  TextQuote,
  UnderlineIcon,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { Highlighter } from "shiki";
import { ActionTooltip } from "@/components/common/action-tooltip";
import { EditorLinkDialog } from "@/components/common/editor-link-dialog";
import { AttachmentCard } from "@/components/task/extensions/attachment-card";
import { EmbedBlock } from "@/components/task/extensions/embed-block";
import type { MentionMember } from "@/components/task/extensions/mention-list";
import { MentionSuggestion } from "@/components/task/extensions/mention-suggestion";
import { MermaidBlock } from "@/components/task/extensions/mermaid-block";
import {
  SHIKI_CODEBLOCK_REFRESH_META,
  ShikiCodeBlock,
} from "@/components/task/extensions/shiki-code-block";
import { TaskItemWithCheckbox } from "@/components/task/extensions/task-item-with-checkbox";
import { TaskDeskMention } from "@/components/task/extensions/taskdesk-mention";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { getModifierKeyText } from "@/hooks/use-keyboard-shortcuts";
import { useShikiHighlighterForCode } from "@/hooks/use-shiki-highlighter-for-code";
import { cn } from "@/lib/cn";
import "@/components/task/editor-styles.css";
import { looksLikeMarkdown, withSafeLinks } from "@/lib/editor-markdown-paste";
import { parseTaskListMarkdownToNodes } from "@/lib/editor-task-list-paste";
import {
  extractIssueKeyFromUrl,
  extractTaskIdFromUrl,
  isYouTubeUrl,
  normalizeUrl,
} from "@/lib/editor-url-utils";
import { isInCodeBlockLanguagePicker } from "@/lib/is-in-codeblock-language-picker";
import { toast } from "@/lib/toast";
import { uploadTaskImage } from "@/lib/upload-task-image";
import {
  extractWorkItemKeyFromUrl,
  WorkItemIssueLink,
} from "./work-item-issue-link";

type CommentEditorProps = {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Accessible name when the editor is reused outside a comment composer. */
  ariaLabel?: string;
  className?: string;
  contentClassName?: string;
  proseClassName?: string;
  /** `true`/`"start"` focus the start, `"end"` the end of the content. */
  autoFocus?: boolean | "start" | "end";
  disabled?: boolean;
  readOnly?: boolean;
  showBubbleMenu?: boolean;
  slashMenuPosition?: "absolute" | "fixed";
  onSubmitShortcut?: () => void;
  onCancelShortcut?: () => void;
  taskId?: string;
  uploadSurface?: "description" | "comment";
  ensureTaskId?: () => Promise<string | null>;
  showQuickAttachButton?: boolean;
  onAttachActionChange?: (attach: (() => void) | null) => void;
  /** A create controller may stage local files without creating a shadow task. */
  onFilesSelected?: (files: File[]) => void;
  /** Native work-item comments store the editor's Tiptap document, not Markdown. */
  documentValue?: unknown;
  onDocumentChange?: (value: unknown) => void;
  /** A text/document pair emitted together for callers that persist a draft. */
  onContentChange?: (value: CommentContentSnapshot) => void;
  /** Enable @mention insertion when the caller has a scoped candidate source. */
  enableMentions?: boolean;
  /** Native work-item comments supply person ids from the scoped mention API. */
  mentionMembers?: MentionMember[];
  /** Optional caller-owned Tiptap nodes/marks for a specialized editor surface. */
  additionalExtensions?: Extensions;
  /** Optional caller-owned slash actions; defaults are unchanged for other surfaces. */
  additionalSlashCommands?: CommentEditorSlashCommand[];
  /** Offer the YouTube embed composer when a video link is pasted. Surfaces whose
   * server drops embed nodes (Pages, KB) turn this off and keep a plain link. */
  allowEmbeds?: boolean;
};

const EMPTY_EXTENSIONS: Extensions = [];
const EMPTY_SLASH_COMMANDS: CommentEditorSlashCommand[] = [];

export type CommentContentSnapshot = {
  text: string;
  document: unknown;
};

type SlashRange = { from: number; to: number };

/** One key of a shortcut hint. `Mod` is ⌘ on Apple platforms and Ctrl elsewhere;
 * `Alt` is ⌥ there and Alt elsewhere. Any other value is shown as written. */
export type EditorShortcutKey = "Mod" | "Alt" | "Shift" | (string & {});

export type CommentEditorSlashCommand = {
  id: string;
  label: string;
  group: "text" | "lists" | "insert";
  /** The editor's real key binding for this action, e.g. `["Mod", "Alt", "2"]`. */
  shortcut?: readonly EditorShortcutKey[];
  icon?: LucideIcon;
  search: string;
  run: (editor: Editor, range: SlashRange) => void;
};

type SlashCommand = CommentEditorSlashCommand;

type SlashMenuState = {
  from: number;
  to: number;
  query: string;
  top: number;
  left: number;
  /** "above" when there is no room below the caret; the menu then grows upward. */
  placement: "below" | "above";
  selectedIndex: number;
};

/** Matches the slash menu's CSS `max-height` (20rem) plus its 8px caret gap. */
const SLASH_MENU_MAX_HEIGHT_PX = 328;

function isApplePlatform() {
  return getModifierKeyText() === "⌘";
}

/** Display labels and the `aria-keyshortcuts` value for a shortcut hint. */
export function describeEditorShortcut(
  keys: readonly EditorShortcutKey[],
  apple = isApplePlatform(),
) {
  const display = keys.map((key) => {
    if (key === "Mod") return apple ? "⌘" : "Ctrl";
    if (key === "Alt") return apple ? "⌥" : "Alt";
    if (key === "Shift") return apple ? "⇧" : "Shift";
    return key.length === 1 ? key.toUpperCase() : key;
  });
  const aria = keys
    .map((key) => {
      if (key === "Mod") return apple ? "Meta" : "Control";
      if (key === "Alt" || key === "Shift") return key;
      return key.length === 1 ? key.toUpperCase() : key;
    })
    .join("+");
  return { display, aria };
}

type HoveredCodeBlock = {
  language: string;
  nodePos: number;
  top: number;
  left: number;
};

/** React layout cleanup can destroy the Tiptap editor before passive effects for
 * the same commit run. Its command manager and view are no longer usable then. */
function isLiveEditor(editor: Editor | null | undefined): editor is Editor {
  return Boolean(editor && !editor.isDestroyed);
}

const CODE_LANG_VALUES = [
  "bash",
  "csharp",
  "cpp",
  "css",
  "go",
  "graphql",
  "html",
  "json",
  "java",
  "javascript",
  "markdown",
  "mermaid",
  "plaintext",
  "python",
  "rust",
  "sql",
  "swift",
  "typescript",
  "yaml",
] as const;

type EmbedComposerErrorKey = "embedErrorInvalidUrl" | "embedErrorYoutubeOnly";

const COMMENT_SHIKI_LANGUAGE_ALIASES: Record<string, string> = {
  plaintext: "text",
};

function normalizeMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n{2,}$/g, "\n");
}

type EmbedComposerState = {
  mode: "choice" | "input";
  url: string;
  top: number;
  left: number;
  linkRange?: { from: number; to: number };
  range?: SlashRange;
};

export default function CommentEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  contentClassName,
  proseClassName,
  autoFocus = false,
  disabled = false,
  readOnly = false,
  showBubbleMenu = true,
  slashMenuPosition = "absolute",
  onSubmitShortcut,
  onCancelShortcut,
  taskId,
  uploadSurface = "comment",
  ensureTaskId,
  showQuickAttachButton = true,
  onAttachActionChange,
  onFilesSelected,
  documentValue,
  onDocumentChange,
  onContentChange,
  enableMentions = true,
  mentionMembers,
  additionalExtensions = EMPTY_EXTENSIONS,
  additionalSlashCommands = EMPTY_SLASH_COMMANDS,
  allowEmbeds = true,
}: CommentEditorProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder =
    placeholder ?? t("activity:comment.leavePlaceholder");
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    activeWorkspace?.id ?? "",
  );
  const mentionMembersRef = useRef<MentionMember[]>([]);
  const defaultMentionMembers = useMemo(
    () =>
      (workspaceUsers?.members ?? []).map((member) => ({
        id: member.userId,
        label: member.user?.name ?? member.user?.email ?? "",
        image: member.user?.image ?? null,
      })),
    [workspaceUsers],
  );
  const resolvedMentionMembers = mentionMembers ?? defaultMentionMembers;
  mentionMembersRef.current = resolvedMentionMembers;
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const isSyncingRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const latestValueRef = useRef(normalizeMarkdown(value || ""));
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const lastEditorRef = useRef<Editor | null>(null);
  const disposedEditorRef = useRef<Editor | null>(null);
  // Re-rendering is enough to heal a disposed instance: Tiptap's `useEditor` re-checks its
  // instance on every render and replaces a destroyed one. Keep this out of the editor deps,
  // otherwise each bump destroys the fresh replacement and the cycle never settles.
  const [, requestEditorRender] = useReducer((count: number) => count + 1, 0);
  const syncGenerationRef = useRef(0);
  const taskIdRef = useRef(taskId);
  const ensureTaskIdRef = useRef(ensureTaskId);
  const uploadSurfaceRef = useRef(uploadSurface);
  const filesSelectedRef = useRef(onFilesSelected);
  filesSelectedRef.current = onFilesSelected;
  const onSubmitShortcutRef = useRef(onSubmitShortcut);
  const onCancelShortcutRef = useRef(onCancelShortcut);
  onSubmitShortcutRef.current = onSubmitShortcut;
  onCancelShortcutRef.current = onCancelShortcut;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Ctrl/⌘+Shift+V asks for plain text; the next paste then skips Markdown parsing.
  const plainPasteRef = useRef(false);
  const slashMenuId = useId();
  const editorRef = useRef<Editor | null>(null);
  const slashMenuRef = useRef<SlashMenuState | null>(null);
  const filteredSlashCommandsRef = useRef<SlashCommand[]>([]);
  const pendingImageInsertRef = useRef<{
    editor: Editor;
    range?: SlashRange;
  } | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  slashMenuRef.current = slashMenu;
  const shikiHighlighterRef = useRef<Highlighter | null>(null);
  const [hoveredCodeBlock, setHoveredCodeBlock] =
    useState<HoveredCodeBlock | null>(null);
  const hoveredCodeBlockElementRef = useRef<HTMLElement | null>(null);
  const codeLanguageHideTimeoutRef = useRef<number | null>(null);
  const codeCopyResetTimeoutRef = useRef<number | null>(null);
  const [isCodeLanguageMenuOpen, setIsCodeLanguageMenuOpen] = useState(false);
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [embedComposer, setEmbedComposer] = useState<EmbedComposerState | null>(
    null,
  );
  const [embedComposerError, setEmbedComposerError] =
    useState<EmbedComposerErrorKey | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const codeLanguages = useMemo(
    () =>
      CODE_LANG_VALUES.map((value) => ({
        value,
        label: t(`activity:comment.editor.codeLang.${value}`),
      })),
    [t],
  );
  const availableShikiLanguages = useMemo(
    () =>
      new Set([
        ...CODE_LANG_VALUES.map(
          (language) => COMMENT_SHIKI_LANGUAGE_ALIASES[language] || language,
        ),
        "text",
      ]),
    [],
  );
  const toShikiLanguage = useCallback(
    (language: string) => {
      const normalized = language.toLowerCase();
      const alias = COMMENT_SHIKI_LANGUAGE_ALIASES[normalized];
      if (alias) return alias;
      if (availableShikiLanguages.has(normalized)) return normalized;
      return "text";
    },
    [availableShikiLanguages],
  );
  const getOverlayPosition = useCallback(
    (editorView: Editor["view"], pos: number) => {
      const coords = editorView.coordsAtPos(pos);
      const shellRect = editorShellRef.current?.getBoundingClientRect();

      if (slashMenuPosition === "fixed" || !shellRect) {
        return { top: coords.bottom + 8, left: coords.left };
      }

      return {
        top: coords.bottom - shellRect.top + 8,
        left: coords.left - shellRect.left,
      };
    },
    [slashMenuPosition],
  );

  useEffect(() => {
    taskIdRef.current = taskId;
    ensureTaskIdRef.current = ensureTaskId;
    uploadSurfaceRef.current = uploadSurface;
  }, [ensureTaskId, taskId, uploadSurface]);

  const insertUploadedAsset = useCallback(
    (
      activeEditor: Editor,
      asset: Awaited<ReturnType<typeof uploadTaskImage>>,
      range?: SlashRange,
    ) => {
      if (!isLiveEditor(activeEditor)) return;
      const chain = activeEditor.chain().focus();

      if (range) {
        chain.deleteRange(range);
      } else {
        const { selection } = activeEditor.state;
        if (!selection.empty) {
          chain.setTextSelection(selection.to);
        }
      }

      if (asset.kind === "image") {
        chain
          .setImage({
            src: asset.url,
            alt: asset.alt,
          })
          .run();
        return;
      }

      chain
        .insertContent({
          type: "attachmentCard",
          attrs: {
            url: asset.url,
            filename: asset.filename,
            mimeType: asset.mimeType,
            size: asset.size,
          },
        })
        .run();
    },
    [],
  );

  const handleAssetFileUpload = useCallback(
    async (file: File, targetEditor?: Editor | null, range?: SlashRange) => {
      if (filesSelectedRef.current) {
        filesSelectedRef.current([file]);
        return;
      }
      const activeEditor = targetEditor || lastEditorRef.current;
      const resolvedTaskId =
        taskIdRef.current ?? (await ensureTaskIdRef.current?.());

      if (!isLiveEditor(activeEditor) || !resolvedTaskId) {
        toast.error(t("activity:comment.editor.uploadsOnlyOnSavedTasks"));
        return;
      }

      const loadingToast = toast.loading(
        t("activity:comment.editor.uploadingFile"),
      );

      try {
        const uploadedAsset = await uploadTaskImage({
          taskId: resolvedTaskId,
          surface: uploadSurfaceRef.current,
          file,
        });
        insertUploadedAsset(activeEditor, uploadedAsset, range);

        toast.dismiss(loadingToast);
        toast.success(
          uploadedAsset.kind === "image"
            ? t("activity:comment.editor.imageUploaded")
            : t("activity:comment.editor.fileAttached"),
        );
      } catch (error) {
        toast.dismiss(loadingToast);
        toast.error(
          error instanceof Error
            ? error.message
            : t("activity:comment.editor.failedToUploadFile"),
        );
      }
    },
    [insertUploadedAsset, t],
  );

  const canUploadFiles = Boolean(taskId || ensureTaskId || onFilesSelected);

  const openImagePicker = useCallback(
    (activeEditor?: Editor | null, range?: SlashRange) => {
      pendingImageInsertRef.current = activeEditor
        ? { editor: activeEditor, range }
        : null;
      imageInputRef.current?.click();
    },
    [],
  );

  const hasFileDrag = useCallback((event: React.DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer?.items || []).some(
      (item) => item.kind === "file",
    );
  }, []);

  const handleShellDragEnter = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (readOnly || disabled || !canUploadFiles || !hasFileDrag(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    [canUploadFiles, disabled, hasFileDrag, readOnly],
  );

  const handleShellDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (readOnly || disabled || !canUploadFiles || !hasFileDrag(event)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isDragActive) {
        setIsDragActive(true);
      }
    },
    [canUploadFiles, disabled, hasFileDrag, isDragActive, readOnly],
  );

  const handleShellDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (readOnly || disabled || !canUploadFiles || !hasFileDrag(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragActive(false);
      }
    },
    [canUploadFiles, disabled, hasFileDrag, readOnly],
  );

  const handleShellDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (readOnly || disabled || !canUploadFiles || !hasFileDrag(event)) {
        return;
      }
      if (filesSelectedRef.current) {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length) {
          event.preventDefault();
          event.stopPropagation();
          filesSelectedRef.current(files);
        }
      }
      dragDepthRef.current = 0;
      setIsDragActive(false);
    },
    [canUploadFiles, disabled, hasFileDrag, readOnly],
  );

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        id: "paragraph",
        label: t("activity:comment.editor.slashParagraph"),
        group: "text",
        icon: Pilcrow,
        search: t("activity:comment.editor.searchParagraph"),
        run: (activeEditor, range) => {
          activeEditor.chain().focus().deleteRange(range).setParagraph().run();
        },
      },
      {
        id: "heading-1",
        label: t("activity:comment.editor.slashHeading1"),
        group: "text",
        icon: Heading1,
        shortcut: ["Mod", "Alt", "1"],
        search: t("activity:comment.editor.searchHeading1"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleHeading({ level: 1 })
            .run();
        },
      },
      {
        id: "heading-2",
        label: t("activity:comment.editor.slashHeading"),
        group: "text",
        icon: Heading2,
        shortcut: ["Mod", "Alt", "2"],
        search: t("activity:comment.editor.searchHeading"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleHeading({ level: 2 })
            .run();
        },
      },
      {
        id: "heading-3",
        label: t("activity:comment.editor.slashHeading3"),
        group: "text",
        icon: Heading3,
        shortcut: ["Mod", "Alt", "3"],
        search: t("activity:comment.editor.searchHeading3"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleHeading({ level: 3 })
            .run();
        },
      },
      {
        id: "bullet-list",
        label: t("activity:comment.editor.slashBulletList"),
        group: "lists",
        icon: List,
        shortcut: ["Mod", "Shift", "8"],
        search: t("activity:comment.editor.searchBulletList"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleBulletList()
            .run();
        },
      },
      {
        id: "task-list",
        label: t("activity:comment.editor.slashTaskList"),
        group: "lists",
        icon: ListTodo,
        shortcut: ["Mod", "Shift", "9"],
        search: t("activity:comment.editor.searchTaskList"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleTaskList()
            .run();
        },
      },
      {
        id: "ordered-list",
        label: t("activity:comment.editor.slashOrderedList"),
        group: "lists",
        icon: ListOrdered,
        shortcut: ["Mod", "Shift", "7"],
        search: t("activity:comment.editor.searchOrderedList"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleOrderedList()
            .run();
        },
      },
      {
        id: "blockquote",
        label: t("activity:comment.editor.slashQuote"),
        group: "insert",
        icon: TextQuote,
        shortcut: ["Mod", "Shift", "B"],
        search: t("activity:comment.editor.searchQuote"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleBlockquote()
            .run();
        },
      },
      {
        id: "code-block",
        label: t("activity:comment.editor.slashCodeBlock"),
        group: "insert",
        icon: SquareCode,
        shortcut: ["Mod", "Alt", "C"],
        search: t("activity:comment.editor.searchCodeBlock"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .toggleCodeBlock()
            .run();
        },
      },
      {
        id: "divider",
        label: t("activity:comment.editor.slashDivider"),
        group: "insert",
        icon: Minus,
        search: t("activity:comment.editor.searchDivider"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .setHorizontalRule()
            .run();
        },
      },
      {
        id: "table",
        label: t("activity:comment.editor.slashTable"),
        group: "insert",
        icon: TableIcon,
        search: t("activity:comment.editor.searchTable"),
        run: (activeEditor, range) => {
          activeEditor
            .chain()
            .focus()
            .deleteRange(range)
            .insertTable({ cols: 3, rows: 3 })
            .run();
        },
      },
      {
        id: "file",
        label: t("activity:comment.editor.slashFile"),
        group: "insert",
        icon: Paperclip,
        search: t("activity:comment.editor.searchFile"),
        run: (activeEditor, range) => {
          activeEditor.chain().focus().deleteRange(range).run();
          openImagePicker(activeEditor);
        },
      },
      ...additionalSlashCommands,
    ],
    [additionalSlashCommands, openImagePicker, t],
  );

  const filteredSlashCommands = useMemo(() => {
    const query = slashMenu?.query.trim().toLowerCase() || "";
    const availableCommands = canUploadFiles
      ? slashCommands
      : slashCommands.filter((command) => command.id !== "file");
    if (!query) return availableCommands;
    return availableCommands.filter(
      (command) =>
        command.label.toLowerCase().includes(query) ||
        command.search.toLowerCase().includes(query),
    );
  }, [canUploadFiles, slashCommands, slashMenu?.query]);
  filteredSlashCommandsRef.current = filteredSlashCommands;

  const editor = useEditor(
    {
      immediatelyRender: false,
      autofocus: autoFocus,
      editable: !readOnly && !disabled,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          trailingNode: false,
          codeBlock: {
            HTMLAttributes: { class: "taskdesk-tiptap-codeblock" },
          },
        }),
        Markdown.configure({
          markedOptions: {
            breaks: true,
            gfm: true,
          },
        }),
        ShikiCodeBlock.configure({
          highlighter: () => shikiHighlighterRef.current,
          resolveLanguage: toShikiLanguage,
          themeDark: "github-dark",
          themeLight: "github-light",
        }),
        MermaidBlock.configure({
          errorKey: "activity:comment.editor.mermaid.renderFailed",
        }),
        EmbedBlock,
        AttachmentCard,
        WorkItemIssueLink,
        ...additionalExtensions,
        TaskDeskMention,
        ...(enableMentions
          ? [
              MentionSuggestion.configure({
                getMembers: () => mentionMembersRef.current,
              }),
            ]
          : []),
        TaskList,
        Image.configure({
          HTMLAttributes: {
            class: "taskdesk-editor-image",
            loading: "lazy",
          },
        }),
        TaskItemWithCheckbox.configure({
          nested: true,
        }),
        Placeholder.configure({
          placeholder: resolvedPlaceholder,
        }),
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      editorProps: {
        attributes: {
          class: cn(
            proseClassName || "taskdesk-comment-editor-prose",
            readOnly && "taskdesk-comment-editor-prose-readonly",
          ),
        },
        handlePaste: (view, event) => {
          const plainPaste = plainPasteRef.current;
          plainPasteRef.current = false;
          if (readOnly || disabled) return false;

          const pastedFiles = Array.from(event.clipboardData?.files || []);
          const pastedFile = pastedFiles[0];

          if (pastedFile) {
            if (!canUploadFiles) return false;
            event.preventDefault();
            if (filesSelectedRef.current) filesSelectedRef.current(pastedFiles);
            else void handleAssetFileUpload(pastedFile, editor);
            return true;
          }

          const plainText = event.clipboardData?.getData("text/plain") || "";
          const taskListNodes = parseTaskListMarkdownToNodes(plainText);
          if (taskListNodes) {
            event.preventDefault();
            const nodes = taskListNodes.map((node) =>
              view.state.schema.nodeFromJSON(node),
            );
            const fragment = Fragment.fromArray(nodes);
            view.dispatch(
              view.state.tr
                .replaceSelection(new Slice(fragment, 0, 0))
                .scrollIntoView(),
            );
            return true;
          }

          const pastedText = plainText.trim();
          const pasteAsMarkdown = () => {
            const liveEditor = editorRef.current;
            if (plainPaste || !isLiveEditor(liveEditor)) return false;
            if (event.clipboardData?.getData("text/html")) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            if (!looksLikeMarkdown(plainText)) return false;
            // Parse and check against the schema before taking the paste over: whatever the
            // parser or the schema refuses falls back to the plain-text paste, never to nothing.
            let content: JSONContent[];
            try {
              const parsed = liveEditor.markdown?.parse(plainText);
              content = parsed ? (withSafeLinks(parsed).content ?? []) : [];
              for (const node of content)
                view.state.schema.nodeFromJSON(node).check();
            } catch {
              return false;
            }
            if (content.length === 0) return false;
            event.preventDefault();
            try {
              liveEditor
                .chain()
                .focus()
                .insertContent(content)
                .scrollIntoView()
                .run();
            } catch {
              view.dispatch(
                view.state.tr.insertText(plainText).scrollIntoView(),
              );
            }
            return true;
          };
          if (!pastedText || /\s/.test(pastedText)) return pasteAsMarkdown();

          const url = normalizeUrl(pastedText);
          if (!url) return pasteAsMarkdown();

          const issueKey =
            extractIssueKeyFromUrl(url) ?? extractWorkItemKeyFromUrl(url);
          const taskIdFromUrl = extractTaskIdFromUrl(url);
          if (issueKey || taskIdFromUrl) {
            event.preventDefault();
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.taskdeskIssueLink.create({
                  url,
                  issueKey: issueKey || "",
                  taskId: taskIdFromUrl || "",
                }),
              ),
            );
            return true;
          }

          if (!allowEmbeds || !isYouTubeUrl(url)) return false;

          event.preventDefault();
          const { from } = view.state.selection;
          const linkMark = view.state.schema.marks.link?.create({ href: url });
          const linkText = view.state.schema.text(
            url,
            linkMark ? [linkMark] : [],
          );
          view.dispatch(
            view.state.tr
              .replaceSelectionWith(linkText, false)
              .scrollIntoView(),
          );
          const coords = getOverlayPosition(view, view.state.selection.from);
          setEmbedComposer({
            mode: "choice",
            url,
            top: coords.top,
            left: coords.left,
            linkRange: { from, to: from + url.length },
          });
          setEmbedComposerError(null);
          return true;
        },
        handleClick: (_view, _pos, event) => {
          if (!readOnlyRef.current) return false;
          const target = event.target as HTMLElement;
          const anchor = target.closest("a");
          if (anchor?.href) {
            window.open(anchor.href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
        handleDrop: (view, event) => {
          if (readOnly || disabled || !canUploadFiles) return false;

          const droppedFiles = Array.from(event.dataTransfer?.files || []);
          const droppedFile = droppedFiles[0];

          if (!droppedFile) return false;

          event.preventDefault();
          const coordinates = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });

          const dropRange = coordinates
            ? { from: coordinates.pos, to: coordinates.pos }
            : undefined;

          if (filesSelectedRef.current) filesSelectedRef.current(droppedFiles);
          else void handleAssetFileUpload(droppedFile, editor, dropRange);
          return true;
        },
        handleTextInput: (view, _from, _to, text) => {
          if (readOnly || disabled || text !== "`") return false;

          const { state } = view;
          const { $from } = state.selection;
          if ($from.parent.type.name !== "paragraph") return false;

          const textBefore = $from.parent.textBetween(
            0,
            $from.parentOffset,
            "\0",
            "\0",
          );

          if (!/^\s*``$/.test(textBefore)) return false;

          const paragraphStart = $from.before();
          const codeBlock = state.schema.nodes.codeBlock?.create();
          if (!codeBlock) return false;

          const tr = state.tr.replaceWith(
            paragraphStart,
            paragraphStart + $from.parent.nodeSize,
            codeBlock,
          );

          tr.setSelection(
            TextSelection.near(tr.doc.resolve(paragraphStart + 1)),
          );
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        handleKeyDown: (view, event) => {
          const isMod = event.metaKey || event.ctrlKey;
          const key = event.key.toLowerCase();
          plainPasteRef.current = isMod && event.shiftKey && key === "v";
          // Tiptap refreshes these props a task after each render; read live values.
          const openSlashMenu = slashMenuRef.current;
          const slashResults = filteredSlashCommandsRef.current;

          if (!readOnly && !disabled && openSlashMenu) {
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              setSlashMenu((current) =>
                current
                  ? {
                      ...current,
                      selectedIndex:
                        event.key === "Home"
                          ? 0
                          : Math.max(slashResults.length - 1, 0),
                    }
                  : current,
              );
              return true;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSlashMenu((current) => {
                if (!current) return current;
                return {
                  ...current,
                  selectedIndex:
                    (current.selectedIndex + 1) %
                    Math.max(slashResults.length, 1),
                };
              });
              return true;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSlashMenu((current) => {
                if (!current) return current;
                return {
                  ...current,
                  selectedIndex:
                    (current.selectedIndex -
                      1 +
                      Math.max(slashResults.length, 1)) %
                    Math.max(slashResults.length, 1),
                };
              });
              return true;
            }

            if (
              (event.key === "Enter" || event.key === "Tab") &&
              slashResults.length
            ) {
              event.preventDefault();
              const liveEditor = editorRef.current;
              if (!isLiveEditor(liveEditor)) return true;
              const command =
                slashResults[
                  Math.min(openSlashMenu.selectedIndex, slashResults.length - 1)
                ];
              if (command) {
                command.run(liveEditor, {
                  from: openSlashMenu.from,
                  to: openSlashMenu.to,
                });
                setSlashMenu(null);
              }
              return true;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setSlashMenu(null);
              return true;
            }
          }

          // Ctrl/⌘+K edits the link on a selection or under the caret. With nothing to
          // link it falls through, so the global command palette still opens.
          if (
            isMod &&
            key === "k" &&
            !event.altKey &&
            !event.shiftKey &&
            !readOnly &&
            !disabled
          ) {
            const { state } = view;
            const linkType = state.schema.marks.link;
            const linkMark = linkType?.isInSet(
              state.storedMarks ?? state.selection.$from.marks(),
            );
            if (linkType && (!state.selection.empty || linkMark)) {
              event.preventDefault();
              event.stopPropagation();
              const href = linkMark?.attrs.href;
              setLinkUrl(typeof href === "string" ? href : "");
              return true;
            }
          }

          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            const submit = onSubmitShortcutRef.current;
            if (!readOnly && !disabled && submit) {
              event.preventDefault();
              submit();
              return true;
            }
          }

          if (
            event.key === "Escape" &&
            !readOnly &&
            !disabled &&
            onCancelShortcutRef.current
          ) {
            event.preventDefault();
            onCancelShortcutRef.current();
            return true;
          }

          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "a" &&
            editor
          ) {
            const { state } = editor.view;
            const { $from } = state.selection;
            if ($from.parent.type.name === "codeBlock") {
              event.preventDefault();
              editor.view.dispatch(
                state.tr.setSelection(
                  TextSelection.create(state.doc, $from.start(), $from.end()),
                ),
              );
              return true;
            }
          }

          return false;
        },
      },
      onUpdate: ({ editor: activeEditor }) => {
        if (readOnly || disabled || isSyncingRef.current) return;
        const markdown = normalizeMarkdown(activeEditor.getMarkdown());
        const document = activeEditor.getJSON();
        latestValueRef.current = markdown;
        onChange?.(markdown);
        onDocumentChange?.(document);
        onContentChangeRef.current?.({ text: markdown, document });
      },
    },
    [
      additionalSlashCommands,
      enableMentions,
      additionalExtensions,
      handleAssetFileUpload,
      resolvedPlaceholder,
      toShikiLanguage,
    ],
  );

  editorRef.current = editor;

  // Tiptap can dispose an instance during a React layout transition before the
  // editor's passive hydration effects run. Render once more so `useEditor` replaces
  // that instance and the editor does not remain a permanently inert shell. The same
  // commit may also have destroyed it deliberately because a dependency changed; the
  // extra render then simply delivers the replacement Tiptap already created.
  useEffect(() => {
    if (!editor) return;
    if (editor.isDestroyed) {
      if (disposedEditorRef.current !== editor) {
        disposedEditorRef.current = editor;
        requestEditorRender();
      }
      return;
    }
    disposedEditorRef.current = null;
  }, [editor]);

  const shikiHighlighter = useShikiHighlighterForCode(editor);
  shikiHighlighterRef.current = shikiHighlighter;

  useEffect(() => {
    if (!onAttachActionChange) return;

    onAttachActionChange(editor ? () => openImagePicker(editor) : null);

    return () => {
      onAttachActionChange(null);
    };
  }, [editor, onAttachActionChange, openImagePicker]);

  // Candidates can arrive (or change with visibility) after the user has
  // already typed `@`; Tiptap only evaluates `items()` on query changes, so ask
  // the active suggestion to re-evaluate against the latest candidates. Keyed by
  // content (ids + labels, in order) so a parent re-render with an equal array
  // does not reset the highlighted row.
  const mentionMembersKey = JSON.stringify(
    resolvedMentionMembers.map((member) => [member.id, member.label]),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh only when candidate content changes
  useEffect(() => {
    if (!isLiveEditor(editor) || !enableMentions) return;
    (
      editor.storage as
        | { taskdeskMentionSuggestion?: { refresh?: () => void } }
        | undefined
    )?.taskdeskMentionSuggestion?.refresh?.();
  }, [editor, enableMentions, mentionMembersKey]);

  useEffect(() => {
    if (!isLiveEditor(editor) || !shikiHighlighter) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(SHIKI_CODEBLOCK_REFRESH_META, true),
    );
  }, [editor, shikiHighlighter]);

  useEffect(() => {
    if (!isLiveEditor(editor) || typeof document === "undefined") return;

    const root = document.documentElement;
    const refreshShikiTheme = () => {
      editor.view.dispatch(
        editor.state.tr.setMeta(SHIKI_CODEBLOCK_REFRESH_META, true),
      );
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "class") {
          refreshShikiTheme();
          break;
        }
      }
    });

    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
    };
  }, [editor]);

  useEffect(() => {
    if (!isLiveEditor(editor)) return;

    const handleImagePreviewClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.classList.contains("taskdesk-editor-image")) return;

      event.preventDefault();
      setPreviewImage({
        src: target.currentSrc || target.src,
        alt: target.alt || t("activity:comment.editor.previewImageAlt"),
      });
    };

    const dom = editor.view.dom;
    dom.addEventListener("click", handleImagePreviewClick);

    return () => {
      dom.removeEventListener("click", handleImagePreviewClick);
    };
  }, [editor, t]);

  const updateSlashMenu = useCallback(
    (activeEditor: Editor) => {
      if (!isLiveEditor(activeEditor) || readOnly || disabled) {
        setSlashMenu(null);
        return;
      }

      const { state, view } = activeEditor;
      const { selection } = state;
      if (!selection.empty) {
        setSlashMenu(null);
        return;
      }

      const { $from } = selection;
      if (!$from.parent.isTextblock) {
        setSlashMenu(null);
        return;
      }

      const textBefore = $from.parent.textBetween(
        0,
        $from.parentOffset,
        "\0",
        "\0",
      );
      const match = textBefore.match(/(?:^|\s)\/([^\s/]*)$/);
      if (!match) {
        setSlashMenu(null);
        return;
      }

      const query = match[1] || "";
      const matchText = match[0];
      const startsWithSpace = matchText.startsWith(" ");
      const slashOffset =
        $from.parentOffset - matchText.length + (startsWithSpace ? 1 : 0);
      const from = $from.start() + slashOffset;
      const to = from + matchText.trimStart().length;
      const below = getOverlayPosition(view, $from.pos);
      // Near the bottom of the viewport the menu opens above the caret instead.
      const caret = view.coordsAtPos($from.pos);
      const viewportHeight =
        typeof window === "undefined" ? 0 : window.innerHeight;
      const spaceBelow = viewportHeight - caret.bottom;
      const placement =
        viewportHeight > 0 &&
        spaceBelow < SLASH_MENU_MAX_HEIGHT_PX &&
        caret.top > spaceBelow
          ? "above"
          : "below";
      // `below.top` is the caret bottom plus an 8px gap; the line height turns it
      // into the caret top minus the same gap. The menu is then lifted by its height.
      const top =
        placement === "above"
          ? below.top - 16 - (caret.bottom - caret.top)
          : below.top;

      setSlashMenu((current) => ({
        from,
        to,
        query,
        top,
        left: below.left,
        placement,
        selectedIndex: current?.query === query ? current.selectedIndex : 0,
      }));
    },
    [disabled, getOverlayPosition, readOnly],
  );

  useEffect(() => {
    if (!isLiveEditor(editor)) return;
    const syncSlash = () => updateSlashMenu(editor);
    editor.on("selectionUpdate", syncSlash);
    editor.on("update", syncSlash);

    return () => {
      editor.off("selectionUpdate", syncSlash);
      editor.off("update", syncSlash);
    };
  }, [editor, updateSlashMenu]);

  useEffect(() => {
    if (!isLiveEditor(editor)) return;
    editor.setEditable(!readOnly && !disabled);
  }, [disabled, editor, readOnly]);

  const slashMenuOpen = Boolean(slashMenu) && !readOnly && !disabled;
  const activeSlashCommand = slashMenu
    ? filteredSlashCommands[
        Math.min(slashMenu.selectedIndex, filteredSlashCommands.length - 1)
      ]
    : undefined;
  const activeSlashOptionId = activeSlashCommand
    ? `${slashMenuId}-option-${activeSlashCommand.id}`
    : null;

  // Focus stays in the editor while the menu is open, so the editor names the
  // listbox it controls and the option a screen reader should announce.
  useEffect(() => {
    if (!isLiveEditor(editor)) return;
    const dom = editor.view.dom;
    if (!slashMenuOpen) {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
      return;
    }
    dom.setAttribute("aria-controls", slashMenuId);
    if (!activeSlashOptionId) {
      dom.removeAttribute("aria-activedescendant");
      return;
    }
    dom.setAttribute("aria-activedescendant", activeSlashOptionId);
    document
      .getElementById(activeSlashOptionId)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeSlashOptionId, editor, slashMenuId, slashMenuOpen]);

  useEffect(() => {
    if (!isLiveEditor(editor)) return;
    if (lastEditorRef.current !== editor) {
      hasHydratedRef.current = false;
      lastEditorRef.current = editor;
    }

    const incoming = normalizeMarkdown(value || "");
    if (!hasHydratedRef.current) {
      isSyncingRef.current = true;
      latestValueRef.current = incoming;
      editor.commands.setContent(incoming, {
        emitUpdate: false,
        contentType: "markdown",
      });
      onContentChangeRef.current?.({
        text: incoming,
        document: editor.getJSON(),
      });
      hasHydratedRef.current = true;
      const generation = ++syncGenerationRef.current;
      queueMicrotask(() => {
        if (generation === syncGenerationRef.current) {
          isSyncingRef.current = false;
        }
      });
      return;
    }

    if (incoming === latestValueRef.current) return;
    isSyncingRef.current = true;
    editor.commands.setContent(incoming, {
      emitUpdate: false,
      contentType: "markdown",
    });
    latestValueRef.current = incoming;
    onContentChangeRef.current?.({
      text: incoming,
      document: editor.getJSON(),
    });
    const generation = ++syncGenerationRef.current;
    queueMicrotask(() => {
      if (generation === syncGenerationRef.current) {
        isSyncingRef.current = false;
      }
    });
  }, [editor, value]);

  useEffect(() => {
    if (!isLiveEditor(editor) || documentValue === undefined) return;
    if (!documentValue || typeof documentValue !== "object") return;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(documentValue))
      return;
    isSyncingRef.current = true;
    editor.commands.setContent(documentValue as JSONContent, {
      emitUpdate: false,
    });
    const markdown = normalizeMarkdown(editor.getMarkdown());
    latestValueRef.current = markdown;
    onChange?.(markdown);
    onContentChangeRef.current?.({
      text: markdown,
      document: editor.getJSON(),
    });
    const generation = ++syncGenerationRef.current;
    queueMicrotask(() => {
      if (generation === syncGenerationRef.current) {
        isSyncingRef.current = false;
      }
    });
  }, [documentValue, editor, onChange]);

  // The bubble menu's pressed states follow the selection: useEditor itself does not
  // re-render on transactions, so without this they would show the last render's state.
  const activeFormats = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current && !current.isDestroyed
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            underline: current.isActive("underline"),
            strike: current.isActive("strike"),
            code: current.isActive("code"),
            heading: current.isActive("heading"),
            blockquote: current.isActive("blockquote"),
            bulletList: current.isActive("bulletList"),
            taskList: current.isActive("taskList"),
            orderedList: current.isActive("orderedList"),
            link: current.isActive("link"),
          }
        : null,
  });

  const setLink = useCallback(() => {
    if (readOnly || disabled || !isLiveEditor(editor)) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(previousUrl || "");
  }, [disabled, editor, readOnly]);

  const resolveCodeBlockNodeData = useCallback(
    (pos: number) => {
      if (!isLiveEditor(editor)) return null;
      const resolvedPos = editor.state.doc.resolve(
        Math.max(0, Math.min(pos, editor.state.doc.content.size)),
      );

      for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
        const node = resolvedPos.node(depth);
        if (node.type.name !== "codeBlock") continue;
        return {
          language: (node.attrs.language as string | undefined) || "auto",
          nodePos: resolvedPos.before(depth),
        };
      }

      return null;
    },
    [editor],
  );

  const updateHoveredCodeBlockFromElement = useCallback(
    (element: HTMLElement | null) => {
      if (!isLiveEditor(editor) || !element) {
        if (!isCodeLanguageMenuOpen) {
          hoveredCodeBlockElementRef.current = null;
          setHoveredCodeBlock(null);
        }
        return;
      }

      const view = editor.view;
      const pos = view.posAtDOM(element, 0);
      const nodeData = resolveCodeBlockNodeData(pos);
      if (!nodeData) return;

      const rect = element.getBoundingClientRect();
      const shellRect = editorShellRef.current?.getBoundingClientRect();
      const top =
        slashMenuPosition === "fixed" || !shellRect
          ? rect.top + 6
          : rect.top - shellRect.top + 6;
      const left =
        slashMenuPosition === "fixed" || !shellRect
          ? rect.right - 12
          : rect.right - shellRect.left - 12;
      setHoveredCodeBlock((current) => {
        if (current?.nodePos !== nodeData.nodePos) {
          setIsCodeCopied(false);
        }

        return {
          language: nodeData.language.toLowerCase(),
          nodePos: nodeData.nodePos,
          top,
          left,
        };
      });
      hoveredCodeBlockElementRef.current = element;
    },
    [
      editor,
      isCodeLanguageMenuOpen,
      resolveCodeBlockNodeData,
      slashMenuPosition,
    ],
  );

  const setCodeLanguage = useCallback(
    (language: string) => {
      if (!isLiveEditor(editor) || !hoveredCodeBlock) return;
      const resolvedLanguage = language === "auto" ? "" : language;
      const { nodePos } = hoveredCodeBlock;
      const node = editor.state.doc.nodeAt(nodePos);
      if (node?.type.name !== "codeBlock") return;

      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeMarkup(nodePos, undefined, {
            ...node.attrs,
            language: resolvedLanguage,
          });
          return true;
        })
        .run();

      setHoveredCodeBlock((current) =>
        current ? { ...current, language } : current,
      );
    },
    [editor, hoveredCodeBlock],
  );

  const activeCodeLanguageLabel = useMemo(() => {
    if (!hoveredCodeBlock) return t("activity:comment.editor.plaintext");
    if (hoveredCodeBlock.language === "auto")
      return t("activity:comment.editor.autoDetect");

    const match = codeLanguages.find(
      (option) => option.value === hoveredCodeBlock.language,
    );
    return match?.label || hoveredCodeBlock.language;
  }, [codeLanguages, hoveredCodeBlock, t]);

  useEffect(() => {
    if (!hoveredCodeBlock || isCodeLanguageMenuOpen) return;

    const syncPosition = () => {
      const element = hoveredCodeBlockElementRef.current;
      if (!element) return;
      updateHoveredCodeBlockFromElement(element);
    };

    window.addEventListener("scroll", syncPosition, true);
    window.addEventListener("resize", syncPosition);
    return () => {
      window.removeEventListener("scroll", syncPosition, true);
      window.removeEventListener("resize", syncPosition);
    };
  }, [
    hoveredCodeBlock,
    isCodeLanguageMenuOpen,
    updateHoveredCodeBlockFromElement,
  ]);

  const groupedSlashCommands = useMemo(
    () => [
      {
        id: "text",
        title: t("activity:comment.editor.slashGroupText"),
        items: filteredSlashCommands.filter(
          (command) => command.group === "text",
        ),
      },
      {
        id: "lists",
        title: t("activity:comment.editor.slashGroupLists"),
        items: filteredSlashCommands.filter(
          (command) => command.group === "lists",
        ),
      },
      {
        id: "insert",
        title: t("activity:comment.editor.slashGroupInsert"),
        items: filteredSlashCommands.filter(
          (command) => command.group === "insert",
        ),
      },
    ],
    [filteredSlashCommands, t],
  );

  const submitEmbedComposer = useCallback(
    (mode: "embed" | "link") => {
      if (!isLiveEditor(editor) || !embedComposer) return;
      const url = normalizeUrl(embedComposer.url);
      if (!url) {
        setEmbedComposerError("embedErrorInvalidUrl");
        return;
      }

      const chain = editor.chain().focus();
      if (embedComposer.mode === "choice" && mode === "link") {
        setEmbedComposer(null);
        setEmbedComposerError(null);
        return;
      }

      if (embedComposer.linkRange) {
        chain.deleteRange(embedComposer.linkRange);
      } else if (embedComposer.range) {
        chain.deleteRange(embedComposer.range);
      }

      if (mode === "link") {
        chain
          .insertContent({
            type: "text",
            text: url,
            marks: [
              {
                type: "link",
                attrs: {
                  href: url,
                },
              },
            ],
          })
          .run();
      } else {
        if (!isYouTubeUrl(url)) {
          setEmbedComposerError("embedErrorYoutubeOnly");
          return;
        }
        chain
          .insertContent({
            type: "embedBlock",
            attrs: {
              url,
              mode: "embed",
            },
          })
          .run();
      }

      setEmbedComposer(null);
      setEmbedComposerError(null);
    },
    [editor, embedComposer],
  );

  useEffect(() => {
    if (!embedComposer) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!embedComposer) return;
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (embedComposer.mode === "choice") {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          return;
        }

        if (event.key === "Tab") {
          event.preventDefault();
          submitEmbedComposer("embed");
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setEmbedComposer(null);
          setEmbedComposerError(null);
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          submitEmbedComposer("embed");
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setEmbedComposer(null);
        setEmbedComposerError(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [embedComposer, submitEmbedComposer]);

  const handleEditorMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (disabled) return;
      const target = event.target as HTMLElement;
      if (target.closest(".taskdesk-codeblock-language")) return;
      const hovered = target.closest(
        "pre.taskdesk-tiptap-codeblock",
      ) as HTMLElement | null;

      if (!hovered) {
        if (!isCodeLanguageMenuOpen) {
          hoveredCodeBlockElementRef.current = null;
          setHoveredCodeBlock(null);
        }
        return;
      }

      if (codeLanguageHideTimeoutRef.current !== null) {
        window.clearTimeout(codeLanguageHideTimeoutRef.current);
        codeLanguageHideTimeoutRef.current = null;
      }
      updateHoveredCodeBlockFromElement(hovered);
    },
    [disabled, isCodeLanguageMenuOpen, updateHoveredCodeBlockFromElement],
  );

  const handleEditorMouseLeave = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const relatedTarget = event.relatedTarget;
      if (isInCodeBlockLanguagePicker(relatedTarget)) return;
      if (isCodeLanguageMenuOpen) return;

      if (codeLanguageHideTimeoutRef.current !== null) {
        window.clearTimeout(codeLanguageHideTimeoutRef.current);
      }

      codeLanguageHideTimeoutRef.current = window.setTimeout(() => {
        codeLanguageHideTimeoutRef.current = null;
        const pickerIsHovered = Boolean(
          document.querySelector(".taskdesk-codeblock-language:hover"),
        );
        if (pickerIsHovered || isCodeLanguageMenuOpen) return;

        hoveredCodeBlockElementRef.current = null;
        setHoveredCodeBlock(null);
      }, 40);
    },
    [isCodeLanguageMenuOpen],
  );

  useEffect(() => {
    return () => {
      if (codeLanguageHideTimeoutRef.current !== null) {
        window.clearTimeout(codeLanguageHideTimeoutRef.current);
      }
      if (codeCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(codeCopyResetTimeoutRef.current);
      }
    };
  }, []);

  const copyHoveredCodeBlock = useCallback(async () => {
    if (!isLiveEditor(editor) || !hoveredCodeBlock) return;
    const node = editor.state.doc.nodeAt(hoveredCodeBlock.nodePos);
    if (node?.type.name !== "codeBlock") return;

    const content = node.textContent || "";
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      setIsCodeCopied(true);
      if (codeCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(codeCopyResetTimeoutRef.current);
      }
      codeCopyResetTimeoutRef.current = window.setTimeout(() => {
        setIsCodeCopied(false);
        codeCopyResetTimeoutRef.current = null;
      }, 1400);
    } catch (_error) {
      // ignore clipboard write failures
    }
  }, [editor, hoveredCodeBlock]);

  return (
    <section
      ref={editorShellRef}
      aria-label={
        ariaLabel ??
        (readOnly
          ? t("activity:comment.editor.ariaCommentContent")
          : t("activity:comment.editor.ariaCommentEditor"))
      }
      className={cn(
        "taskdesk-comment-editor-shell",
        isDragActive && "is-drag-active",
        readOnly && "taskdesk-comment-editor-shell-readonly",
        className,
      )}
      onDragEnter={handleShellDragEnter}
      onDragOver={handleShellDragOver}
      onDragLeave={handleShellDragLeave}
      onDropCapture={onFilesSelected ? handleShellDrop : undefined}
      onDrop={handleShellDrop}
    >
      {!readOnly && !disabled && (
        <Input
          ref={imageInputRef}
          type="file"
          multiple={Boolean(onFilesSelected)}
          // Unstyled: the styled control's `relative inline-flex w-full` outranks `sr-only` in the
          // built CSS, which left an empty line box (a blank band) above every editable editor.
          unstyled
          className="sr-only"
          // Opened only programmatically (slash menu / paste); an unlabelled,
          // invisible Tab stop in front of the editor is a keyboard defect.
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            const file = files[0];
            if (!file) return;
            if (filesSelectedRef.current) {
              filesSelectedRef.current(files);
              event.target.value = "";
              return;
            }

            const pendingInsert = pendingImageInsertRef.current;
            pendingImageInsertRef.current = null;
            void handleAssetFileUpload(
              file,
              pendingInsert?.editor,
              pendingInsert?.range,
            );

            event.target.value = "";
          }}
        />
      )}
      {editor && hoveredCodeBlock && !disabled && (
        <div
          className="taskdesk-codeblock-language"
          style={{
            top: hoveredCodeBlock.top,
            left: hoveredCodeBlock.left,
            position: slashMenuPosition,
          }}
        >
          <Button
            variant="ghost"
            type="button"
            className="taskdesk-codeblock-language-trigger taskdesk-codeblock-copy-trigger"
            aria-label={
              isCodeCopied
                ? t("activity:comment.editor.ariaCopied")
                : t("activity:comment.editor.ariaCopyCode")
            }
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              void copyHoveredCodeBlock();
            }}
          >
            {isCodeCopied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            <span>
              {isCodeCopied
                ? t("activity:comment.editor.copied")
                : t("activity:comment.editor.copy")}
            </span>
          </Button>
          {!readOnly && (
            <DropdownMenu
              open={isCodeLanguageMenuOpen}
              onOpenChange={setIsCodeLanguageMenuOpen}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  type="button"
                  className="taskdesk-codeblock-language-trigger"
                >
                  <span className="truncate">{activeCodeLanguageLabel}</span>
                  <ChevronDown className="size-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="bottom"
                sideOffset={6}
                className="max-h-72 w-48 overflow-y-auto"
              >
                <DropdownMenuRadioGroup
                  value={hoveredCodeBlock.language}
                  onValueChange={setCodeLanguage}
                >
                  <DropdownMenuRadioItem value="auto">
                    {t("activity:comment.editor.autoDetect")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {codeLanguages.map(({ value, label }) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {editor && !readOnly && !disabled && showBubbleMenu && (
        <BubbleMenu
          editor={editor}
          className="taskdesk-comment-editor-bubble"
          shouldShow={({ editor: activeEditor, from, to }) => {
            if (activeEditor.isActive("embedBlock")) return false;
            if (activeEditor.isActive("image")) return false;
            if (activeEditor.isEmpty) return false;
            return from !== to;
          }}
        >
          <ActionTooltip label={t("activity:comment.editor.bubbleBold")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.bold) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.bubbleBold")}
              aria-pressed={Boolean(activeFormats?.bold)}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.bubbleItalic")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.italic) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.bubbleItalic")}
              aria-pressed={Boolean(activeFormats?.italic)}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.bubbleUnderline")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.underline) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.bubbleUnderline")}
              aria-pressed={Boolean(activeFormats?.underline)}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <UnderlineIcon className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.bubbleStrike")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.strike) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.bubbleStrike")}
              aria-pressed={Boolean(activeFormats?.strike)}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.bubbleCode")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.code) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.bubbleCode")}
              aria-pressed={Boolean(activeFormats?.code)}
              onClick={() => editor.chain().focus().toggleCode().run()}
            >
              <Code className="size-3.5" />
            </Button>
          </ActionTooltip>
          <span className="taskdesk-tiptap-bubble-separator" />
          <ActionTooltip label={t("activity:comment.editor.bubbleHeading")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.heading) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.bubbleHeading")}
              aria-pressed={Boolean(activeFormats?.heading)}
              onClick={() =>
                // Any heading level turns back into text; text becomes a level-2 heading.
                editor.isActive("heading")
                  ? editor.chain().focus().setParagraph().run()
                  : editor.chain().focus().setHeading({ level: 2 }).run()
              }
            >
              <Heading2 className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.bubbleQuote")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.blockquote) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.bubbleQuote")}
              aria-pressed={Boolean(activeFormats?.blockquote)}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <TextQuote className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.slashBulletList")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.bulletList) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.slashBulletList")}
              aria-pressed={Boolean(activeFormats?.bulletList)}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.slashTaskList")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.taskList) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.slashTaskList")}
              aria-pressed={Boolean(activeFormats?.taskList)}
              onClick={() => editor.chain().focus().toggleTaskList().run()}
            >
              <ListTodo className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.slashOrderedList")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.orderedList) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.slashOrderedList")}
              aria-pressed={Boolean(activeFormats?.orderedList)}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.enterUrl")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                Boolean(activeFormats?.link) &&
                  "bg-accent text-accent-foreground",
              )}
              aria-label={t("activity:comment.editor.enterUrl")}
              onClick={setLink}
            >
              <Link2 className="size-3.5" />
            </Button>
          </ActionTooltip>
          {canUploadFiles && (
            <ActionTooltip label={t("activity:comment.attachFile")}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="taskdesk-comment-editor-bubble-btn"
                aria-label={t("activity:comment.attachFile")}
                onClick={() => openImagePicker(editor)}
              >
                <Paperclip className="size-3.5" />
              </Button>
            </ActionTooltip>
          )}
        </BubbleMenu>
      )}
      {editor && !readOnly && !disabled && showBubbleMenu && (
        <BubbleMenu
          editor={editor}
          pluginKey="taskdesk-comment-table-bubble"
          className="taskdesk-comment-editor-bubble"
          shouldShow={({ editor: activeEditor, from, to }) =>
            activeEditor.isActive("table") && from === to
          }
        >
          <ActionTooltip
            label={t("activity:comment.editor.table.addColumnBefore")}
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="taskdesk-comment-editor-bubble-btn"
              aria-label={t("activity:comment.editor.table.addColumnBefore")}
              onClick={() => editor.chain().focus().addColumnBefore().run()}
            >
              <BetweenVerticalStart className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip
            label={t("activity:comment.editor.table.addColumnAfter")}
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="taskdesk-comment-editor-bubble-btn"
              aria-label={t("activity:comment.editor.table.addColumnAfter")}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              <BetweenVerticalEnd className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip
            label={t("activity:comment.editor.table.deleteColumn")}
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                "text-destructive",
              )}
              aria-label={t("activity:comment.editor.table.deleteColumn")}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              <Columns3 className="size-3.5" />
            </Button>
          </ActionTooltip>
          <span className="taskdesk-tiptap-bubble-separator" />
          <ActionTooltip
            label={t("activity:comment.editor.table.addRowBefore")}
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="taskdesk-comment-editor-bubble-btn"
              aria-label={t("activity:comment.editor.table.addRowBefore")}
              onClick={() => editor.chain().focus().addRowBefore().run()}
            >
              <BetweenHorizontalStart className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.table.addRowAfter")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="taskdesk-comment-editor-bubble-btn"
              aria-label={t("activity:comment.editor.table.addRowAfter")}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <BetweenHorizontalEnd className="size-3.5" />
            </Button>
          </ActionTooltip>
          <ActionTooltip label={t("activity:comment.editor.table.deleteRow")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                "text-destructive",
              )}
              aria-label={t("activity:comment.editor.table.deleteRow")}
              onClick={() => editor.chain().focus().deleteRow().run()}
            >
              <Rows3 className="size-3.5" />
            </Button>
          </ActionTooltip>
          <span className="taskdesk-tiptap-bubble-separator" />
          <ActionTooltip label={t("activity:comment.editor.table.deleteTable")}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={cn(
                "taskdesk-comment-editor-bubble-btn",
                "text-destructive",
              )}
              aria-label={t("activity:comment.editor.table.deleteTable")}
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              <Grid2x2X className="size-3.5" />
            </Button>
          </ActionTooltip>
        </BubbleMenu>
      )}
      {slashMenu && slashMenuOpen && (
        <div
          id={slashMenuId}
          role="listbox"
          aria-label={t("activity:comment.editor.slashMenuLabel")}
          className={cn(
            "taskdesk-tiptap-slash-menu",
            slashMenu.placement === "above" && "is-above",
          )}
          style={{
            top: slashMenu.top,
            left: slashMenu.left,
            position: slashMenuPosition,
          }}
        >
          {filteredSlashCommands.length > 0 ? (
            groupedSlashCommands.map((group) => {
              if (!group.items.length) return null;
              const titleId = `${slashMenuId}-group-${group.id}`;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an ARIA listbox groups its options with role="group"; a fieldset groups form controls
                <div
                  key={group.id}
                  role="group"
                  aria-labelledby={titleId}
                  className="taskdesk-tiptap-slash-group"
                >
                  <div
                    id={titleId}
                    role="presentation"
                    className="taskdesk-tiptap-slash-group-title"
                  >
                    {group.title}
                  </div>
                  {group.items.map((command) => {
                    const index = filteredSlashCommands.findIndex(
                      (candidate) => candidate.id === command.id,
                    );
                    const isSelected = activeSlashCommand?.id === command.id;
                    const shortcut = command.shortcut
                      ? describeEditorShortcut(command.shortcut)
                      : null;
                    const Icon = command.icon;
                    return (
                      <Button
                        variant="ghost"
                        key={command.id}
                        id={`${slashMenuId}-option-${command.id}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        aria-keyshortcuts={shortcut?.aria}
                        // Options are chosen with the mouse or from the editor's
                        // keys; they never take focus away from the editor.
                        tabIndex={-1}
                        className={cn(
                          "taskdesk-tiptap-slash-item",
                          isSelected && "is-selected",
                        )}
                        onMouseEnter={() =>
                          setSlashMenu((current) =>
                            current
                              ? { ...current, selectedIndex: index }
                              : current,
                          )
                        }
                        onMouseDown={(event) => {
                          event.preventDefault();
                          if (!isLiveEditor(editor)) return;
                          command.run(editor, {
                            from: slashMenu.from,
                            to: slashMenu.to,
                          });
                          setSlashMenu(null);
                        }}
                      >
                        <span className="taskdesk-tiptap-slash-main">
                          {Icon && (
                            <Icon
                              aria-hidden="true"
                              className="taskdesk-tiptap-slash-icon"
                            />
                          )}
                          <span className="taskdesk-tiptap-slash-label">
                            {command.label}
                          </span>
                        </span>
                        {shortcut && (
                          <KbdGroup
                            aria-hidden="true"
                            className="taskdesk-tiptap-slash-shortcut"
                          >
                            {shortcut.display.map((key) => (
                              <Kbd key={key}>{key}</Kbd>
                            ))}
                          </KbdGroup>
                        )}
                      </Button>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <div className="taskdesk-tiptap-slash-empty">
              {t("activity:comment.editor.noCommands")}
            </div>
          )}
        </div>
      )}
      {editor && embedComposer && (
        <div
          className="taskdesk-embed-composer"
          style={{
            top: embedComposer.top,
            left: embedComposer.left,
            position: slashMenuPosition,
          }}
        >
          {embedComposer.mode === "choice" ? (
            <div className="taskdesk-embed-choice-menu">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="taskdesk-embed-choice-item is-primary"
                onMouseDown={(event) => {
                  event.preventDefault();
                  submitEmbedComposer("embed");
                }}
              >
                <span>{t("activity:comment.editor.embedVideo")}</span>
                <span className="taskdesk-embed-choice-hint">
                  {t("activity:comment.editor.hintTab")}
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="taskdesk-embed-choice-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setEmbedComposer(null);
                  setEmbedComposerError(null);
                }}
              >
                <span>{t("activity:comment.editor.keepAsLink")}</span>
                <span className="taskdesk-embed-choice-hint">
                  {t("activity:comment.editor.hintEsc")}
                </span>
              </Button>
            </div>
          ) : (
            <form
              className="taskdesk-embed-composer-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitEmbedComposer("embed");
              }}
            >
              <Input
                size="sm"
                value={embedComposer.url}
                onChange={(event) => {
                  setEmbedComposer((current) =>
                    current ? { ...current, url: event.target.value } : current,
                  );
                  if (embedComposerError) setEmbedComposerError(null);
                }}
                placeholder={t("activity:comment.editor.pasteUrl")}
                autoFocus
              />
              <div className="taskdesk-embed-composer-actions">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => submitEmbedComposer("link")}
                >
                  {t("activity:comment.editor.asLink")}
                </Button>
                <Button type="submit" size="xs">
                  {t("activity:comment.editor.embed")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setEmbedComposer(null);
                    setEmbedComposerError(null);
                  }}
                >
                  {t("common:actions.cancel")}
                </Button>
              </div>
              {embedComposerError && (
                <p className="taskdesk-embed-composer-error">
                  {t(`activity:comment.editor.${embedComposerError}`)}
                </p>
              )}
            </form>
          )}
        </div>
      )}
      <EditorContent
        editor={editor}
        className={cn("taskdesk-comment-editor-content", contentClassName)}
        onMouseMove={handleEditorMouseMove}
        onMouseLeave={handleEditorMouseLeave}
      />
      {!readOnly && !disabled && showQuickAttachButton && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="taskdesk-editor-quick-attach"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => openImagePicker(editor)}
          aria-label={t("activity:comment.attachFile")}
        >
          <Paperclip className="size-3.5" />
        </Button>
      )}
      {isDragActive && (
        <div className="taskdesk-editor-drop-indicator">
          <span>{t("activity:comment.editor.dropImageToUpload")}</span>
        </div>
      )}
      {linkUrl !== null && isLiveEditor(editor) && (
        <EditorLinkDialog
          editor={editor}
          scopeKey={taskId}
          editable={!readOnly && !disabled}
          initialUrl={linkUrl}
          label={t("activity:comment.editor.enterUrl")}
          onClose={() => setLinkUrl(null)}
        />
      )}
      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(open) => {
          if (!open) setPreviewImage(null);
        }}
      >
        <DialogPopup
          className="max-w-6xl border-0 bg-transparent p-0 shadow-none before:hidden"
          showCloseButton={false}
          bottomStickOnMobile={false}
        >
          {previewImage && (
            <div className="flex max-h-[90vh] items-center justify-center p-4">
              <img
                src={previewImage.src}
                alt={previewImage.alt}
                className="max-h-[85vh] max-w-[92vw] rounded-xl border border-white/12 bg-black/30 object-contain shadow-2xl"
              />
            </div>
          )}
        </DialogPopup>
      </Dialog>
    </section>
  );
}
