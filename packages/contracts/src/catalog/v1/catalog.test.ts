import { describe, expect, it } from "vitest";

import {
  CatalogItemListQuerySchema,
  CreateCatalogFieldSchema,
  CreateCatalogItemSchema,
} from "./catalog.js";

describe("catalog contracts", () => {
  const item = {
    kind: "service", name: "Alquiler SUV", price: "750.00", currency: "GTQ",
    availabilityMode: "interval_capacity", capacity: 2, locksAdvisor: false,
  };

  it("supports a service with interval capacity independently of item kind", () => {
    expect(CreateCatalogItemSchema.parse(item)).toMatchObject({ kind: "service", capacity: 2 });
    expect(CreateCatalogItemSchema.parse({ ...item, kind: "product" }).kind).toBe("product");
  });

  it("rejects capacity on a non-capacity item", () => {
    expect(CreateCatalogItemSchema.safeParse({ ...item, availabilityMode: "stock" }).success).toBe(false);
    expect(CreateCatalogItemSchema.safeParse({ ...item, capacity: null }).success).toBe(false);
  });

  it("requires custom fields to belong to a type or a single item", () => {
    const field = { key: "modelo", label: "Modelo", valueType: "text" };
    expect(CreateCatalogFieldSchema.safeParse(field).success).toBe(false);
    expect(CreateCatalogFieldSchema.safeParse({ ...field, itemId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
  });

  it("does not interpret the text false as true in filters", () => {
    expect(CatalogItemListQuerySchema.parse({ includeInactive: "false" }).includeInactive).toBe(false);
  });
});
