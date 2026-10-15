import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CrmShell } from "./crm-shell.js";

vi.mock("next/navigation", () => ({ usePathname: () => "/inbox" }));

describe("CRM sidebar branding", () => {
  it("renders the supplied artwork as an image and the Business Assistant name", () => {
    const markup = renderToStaticMarkup(
      <CrmShell>
        <div>Contenido</div>
      </CrmShell>,
    );

    expect(markup).toContain('aria-label="Business Assistant, resumen"');
    expect(markup).toContain("business-assistant-brand");
    expect(markup).toContain("<img");
    expect(markup).toContain("Business");
    expect(markup).toContain("Assistant");
    expect(markup).not.toContain("Quantum CRM");
  });
});
