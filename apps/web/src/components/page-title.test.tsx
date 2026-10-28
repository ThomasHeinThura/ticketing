import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PageTitle from "./page-title";

afterEach(cleanup);

describe("PageTitle", () => {
  it("lets the page's own title beat a layout fallback mounted around it", () => {
    render(
      <>
        <PageTitle title="API keys" />
        <PageTitle title="Projects" fallback />
      </>,
    );
    expect(document.title).toBe("API keys · TaskDesk");
  });

  it("applies the fallback when no page sets a title", () => {
    render(<PageTitle title="Projects" fallback />);
    expect(document.title).toBe("Projects · TaskDesk");
  });
});
