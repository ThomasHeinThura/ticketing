import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  useDelayedPending,
} from "@taskdesk/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInstanceUsers } from "@/hooks/queries/god-mode/use-instance-users";
import { authClient } from "@/lib/auth-client";

type OwnerOption = { id: string; name: string; email: string };

const SEARCH_DELAY_MS = 250;

function optionLabel(option: OwnerOption): string {
  return `${option.name} (${option.email})`;
}

type WorkspaceOwnerPickerProps = {
  id?: string;
  /** The chosen owner's user id, or `null` until the picker has defaulted to the signed-in user. */
  value: string | null;
  onChange: (userId: string) => void;
  disabled?: boolean;
};

/**
 * Picks the person who becomes the owner of a new workspace. The instance administrator
 * creating it is NOT made a member unless they pick themselves, which is the default.
 * Candidates are active, unsuspended staff users, searched on the server by name or email;
 * a person with no account yet cannot be named (invitations never grant the owner role).
 */
export function WorkspaceOwnerPicker({
  id,
  value,
  onChange,
  disabled,
}: WorkspaceOwnerPickerProps) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const selfId = session?.user?.id;
  const selfName = session?.user?.name ?? "";
  const selfEmail = session?.user?.email ?? "";
  const [selected, setSelected] = useState<OwnerOption | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [search, setSearch] = useState("");

  // The administrator names themselves until they choose someone else.
  useEffect(() => {
    if (value !== null || !selfId) return;
    const self = { id: selfId, name: selfName, email: selfEmail };
    setSelected(self);
    setInputValue(optionLabel(self));
    onChange(selfId);
  }, [value, selfId, selfName, selfEmail, onChange]);

  useEffect(() => {
    const timer = setTimeout(
      () => setSearch(inputValue.trim()),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Right after a pick the input holds the chosen person's label; search by nothing then, so
  // the list still offers everyone rather than only the person already chosen.
  const query = selected && inputValue === optionLabel(selected) ? "" : search;
  const { data, isPending, isError } = useInstanceUsers({
    side: "staff",
    active: "true",
    limit: "20",
    ...(query ? { q: query } : {}),
  });
  const placeholderVisible = useDelayedPending(isPending);
  const options = useMemo<OwnerOption[]>(
    () =>
      (data?.data ?? [])
        .filter((user) => !user.isSuspended)
        .map((user) => ({ id: user.id, name: user.name, email: user.email })),
    [data],
  );

  return (
    <Combobox<OwnerOption>
      items={options}
      value={selected}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      onValueChange={(next) => {
        if (!next) return;
        setSelected(next);
        setInputValue(optionLabel(next));
        onChange(next.id);
      }}
      itemToStringLabel={optionLabel}
      isItemEqualToValue={(item, current) => item.id === current.id}
      filter={null}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        aria-label={t("workspace:create.ownerLabel")}
        placeholder={t("workspace:create.ownerPlaceholder")}
        showTrigger
      />
      <ComboboxPopup>
        <ComboboxStatus>
          {isError ? (
            t("workspace:create.ownerError")
          ) : isPending || placeholderVisible ? (
            <span
              style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
            >
              {t("workspace:create.ownerLoading")}
            </span>
          ) : null}
        </ComboboxStatus>
        <ComboboxEmpty>{t("workspace:create.ownerEmpty")}</ComboboxEmpty>
        <ComboboxList>
          {(option: OwnerOption) => (
            <ComboboxItem key={option.id} value={option}>
              {optionLabel(option)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

export default WorkspaceOwnerPicker;
