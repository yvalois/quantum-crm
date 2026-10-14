import { describe, expect, it, vi } from "vitest";

import { CatalogService, CatalogValidationError, type CatalogRepository } from "./catalog-service.js";

const editor = ["crm:catalog:read", "crm:catalog:write", "crm:catalog:stock"] as const;
const fieldId = "00000000-0000-4000-8000-000000000010";

function repository(): CatalogRepository {
  return {
    listCategories: vi.fn().mockResolvedValue([]), createCategory: vi.fn(),
    listTypes: vi.fn().mockResolvedValue([]), createType: vi.fn(),
    listFields: vi.fn().mockResolvedValue([]), createField: vi.fn(),
    listItems: vi.fn().mockResolvedValue([]), findItem: vi.fn().mockResolvedValue(null),
    createItem: vi.fn(), updateItem: vi.fn(), adjustStock: vi.fn(),
  };
}

describe("catalog item validation", () => {
  const input = {
    kind: "service" as const, name: "RAV4", description: "", sku: null,
    categoryId: null, itemTypeId: null, price: "450.00", currency: "GTQ",
    availabilityMode: "interval_capacity" as const, capacity: 2, locksAdvisor: false,
    fields: {},
  };

  it("accepts a capacity service without fixed vehicle-specific fields", async () => {
    const port = repository();
    await expect(new CatalogService(port).createItem(editor, input)).resolves.toBeUndefined();
    expect(port.createItem).toHaveBeenCalledOnce();
  });

  it("rejects a field that is not applicable to the item", async () => {
    const port = repository();
    await expect(new CatalogService(port).createItem(editor, {
      ...input, fields: { [fieldId]: "five" },
    })).rejects.toBeInstanceOf(CatalogValidationError);
    expect(port.createItem).not.toHaveBeenCalled();
  });
});
