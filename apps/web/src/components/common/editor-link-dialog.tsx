import {
  Button,
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import type { Editor } from "@tiptap/core";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Keep the editor's mapped selection while a library dialog owns focus. */
export function EditorLinkDialog({
  editor,
  editable,
  initialUrl,
  label,
  onClose,
}: {
  editor: Editor;
  editable: boolean;
  initialUrl: string;
  label: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initialUrl);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup
        closeLabel={t("common:actions.close")}
        initialFocus={inputRef}
        finalFocus={() => (editor.isDestroyed ? null : editor.view.dom)}
        aria-describedby={undefined}
        className="max-w-sm"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!editable || editor.isDestroyed || !editor.isEditable) return;
            const chain = editor.chain().focus().extendMarkRange("link");
            if (url.trim()) chain.setLink({ href: url }).run();
            else chain.unsetLink().run();
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="grid gap-2">
              <Label htmlFor={inputId}>{label}</Label>
              <Input
                ref={inputRef}
                id={inputId}
                inputMode="url"
                autoComplete="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={!editable}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={!editable}>
              {t("common:actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
