import { Input } from "@taskdesk/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";

function DraftProbe() {
  const { t } = useTranslation("common");
  const [draft, setDraft] = useState("");

  return (
    <>
      <output data-testid="translated">{t("label")}</output>
      <Input
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
    </>
  );
}

function NamespaceProbe({
  namespaces,
  nsMode,
}: {
  namespaces: string | string[];
  nsMode: "default" | "fallback";
}) {
  const { t } = useTranslation(namespaces, { nsMode });
  return <output data-testid="translated">{t("label")}</output>;
}

async function initializedI18n(resources: Record<string, { label?: string }>) {
  const instance = createInstance();
  await instance.init({
    lng: "en-US",
    defaultNS: "common",
    resources: { "en-US": resources },
  });
  return instance;
}

describe("react-i18next translation snapshot cache", () => {
  it("switches same-locale instances without resetting the local input draft", async () => {
    const first = await initializedI18n({
      common: { label: "First instance" },
    });
    const second = await initializedI18n({
      common: { label: "Second instance" },
    });
    const view = render(
      <I18nextProvider i18n={first}>
        <DraftProbe />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("translated")).toHaveTextContent(
      "First instance",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), {
      target: { value: "keep this unsaved draft" },
    });

    view.rerender(
      <I18nextProvider i18n={second}>
        <DraftProbe />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("translated")).toHaveTextContent(
      "Second instance",
    );
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "keep this unsaved draft",
    );
  });

  it("updates the fixed translator when the requested namespace changes", async () => {
    const instance = await initializedI18n({
      first: { label: "First namespace" },
      second: { label: "Second namespace" },
    });
    const view = render(
      <I18nextProvider i18n={instance}>
        <NamespaceProbe namespaces="first" nsMode="default" />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("translated")).toHaveTextContent(
      "First namespace",
    );
    view.rerender(
      <I18nextProvider i18n={instance}>
        <NamespaceProbe namespaces="second" nsMode="default" />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("translated")).toHaveTextContent(
      "Second namespace",
    );
  });

  it("updates namespace fallback behavior when nsMode changes", async () => {
    const instance = await initializedI18n({
      primary: {},
      secondary: { label: "Secondary namespace" },
    });
    const view = render(
      <I18nextProvider i18n={instance}>
        <NamespaceProbe
          namespaces={["primary", "secondary"]}
          nsMode="default"
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("translated")).toHaveTextContent("label");
    view.rerender(
      <I18nextProvider i18n={instance}>
        <NamespaceProbe
          namespaces={["primary", "secondary"]}
          nsMode="fallback"
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("translated")).toHaveTextContent(
      "Secondary namespace",
    );
  });
});
