import { randomUUID } from "node:crypto";

import type { CatalogItem, CreateCatalogItem } from "@quantum-crm/contracts";

import { IamAuthorizationError, type IamPermission } from "../iam/index.js";

export class CatalogValidationError extends Error {}
export class CatalogNotFoundError extends Error {}
export class CatalogVersionConflictError extends Error {}
export class CatalogStockConflictError extends Error {}
export class CatalogIdempotencyConflictError extends Error {}

export interface CatalogCategory {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly active: boolean;
}
export interface CatalogType {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
}
export interface CatalogField {
  readonly id: string;
  readonly itemTypeId: string | null;
  readonly itemId: string | null;
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly valueType: "text" | "number" | "date" | "boolean" | "single_select" | "multi_select" | "color";
  readonly options: readonly { readonly key: string; readonly label: string; readonly color?: string }[];
  readonly required: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
}
export interface CatalogRepository {
  listCategories(): Promise<readonly CatalogCategory[]>;
  createCategory(input: CatalogCategory): Promise<CatalogCategory>;
  listTypes(): Promise<readonly CatalogType[]>;
  createType(input: CatalogType): Promise<CatalogType>;
  listFields(input: { readonly itemTypeId?: string; readonly itemId?: string }): Promise<readonly CatalogField[]>;
  createField(input: CatalogField): Promise<CatalogField>;
  listItems(input: { readonly kind?: "product" | "service"; readonly categoryId?: string; readonly query?: string; readonly includeInactive: boolean; readonly limit: number }): Promise<readonly CatalogItem[]>;
  findItem(id: string): Promise<CatalogItem | null>;
  createItem(input: Omit<CatalogItem, "stockOnHand">): Promise<CatalogItem>;
  updateItem(input: { readonly item: Omit<CatalogItem, "stockOnHand">; readonly expectedVersion: bigint }): Promise<CatalogItem | null>;
  adjustStock(input: { readonly itemId: string; readonly delta: number; readonly reason: string; readonly actorMemberId: string; readonly idempotencyKey: string }): Promise<CatalogItem>;
}

function requirePermission(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

function validFieldValue(field: CatalogField, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return !field.required;
  if (field.valueType === "text") return typeof value === "string" && value.length <= 4000;
  if (field.valueType === "number") return typeof value === "number" && Number.isFinite(value);
  if (field.valueType === "boolean") return typeof value === "boolean";
  if (field.valueType === "date") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(value));
  if (field.valueType === "color") return typeof value === "string" && /^#[0-9a-fA-F]{6}$/u.test(value);
  const keys = new Set(field.options.map((option) => option.key));
  if (field.valueType === "single_select") return typeof value === "string" && keys.has(value);
  return Array.isArray(value) && value.length <= 100 && value.every((entry) => typeof entry === "string" && keys.has(entry)) && new Set(value).size === value.length;
}

export class CatalogService {
  public constructor(private readonly repository: CatalogRepository) {}

  public async listCategories(permissions: readonly IamPermission[]) {
    requirePermission(permissions, "crm:catalog:read");
    return this.repository.listCategories();
  }

  public async createCategory(permissions: readonly IamPermission[], name: string, parentId?: string | null) {
    requirePermission(permissions, "crm:catalog:write");
    if (parentId && !(await this.repository.listCategories()).some((category) => category.id === parentId && category.active)) throw new CatalogNotFoundError();
    return this.repository.createCategory({ id: randomUUID(), name: name.trim(), parentId: parentId ?? null, active: true });
  }

  public async listTypes(permissions: readonly IamPermission[]) {
    requirePermission(permissions, "crm:catalog:read");
    return this.repository.listTypes();
  }

  public async createType(permissions: readonly IamPermission[], name: string, description: string) {
    requirePermission(permissions, "crm:catalog:write");
    return this.repository.createType({ id: randomUUID(), name: name.trim(), description: description.trim(), active: true });
  }

  public async listFields(permissions: readonly IamPermission[], input: { readonly itemTypeId?: string; readonly itemId?: string }) {
    requirePermission(permissions, "crm:catalog:read");
    return this.repository.listFields(input);
  }

  public async createField(permissions: readonly IamPermission[], field: Omit<CatalogField, "id" | "active">) {
    requirePermission(permissions, "crm:catalog:write");
    if ((field.itemTypeId === null) === (field.itemId === null)) throw new CatalogValidationError("A field needs one scope");
    if (field.itemId && !(await this.repository.findItem(field.itemId))) throw new CatalogNotFoundError();
    if (field.itemTypeId && !(await this.repository.listTypes()).some((type) => type.id === field.itemTypeId && type.active)) throw new CatalogNotFoundError();
    if (["single_select", "multi_select"].includes(field.valueType) && field.options.length === 0) throw new CatalogValidationError("Selection fields require options");
    if (new Set(field.options.map((option) => option.key)).size !== field.options.length) throw new CatalogValidationError("Duplicate option keys");
    return this.repository.createField({ ...field, id: randomUUID(), active: true });
  }

  public async listItems(permissions: readonly IamPermission[], input: Parameters<CatalogRepository["listItems"]>[0]) {
    requirePermission(permissions, "crm:catalog:read");
    return this.repository.listItems(input);
  }

  public async findItem(permissions: readonly IamPermission[], id: string) {
    requirePermission(permissions, "crm:catalog:read");
    const item = await this.repository.findItem(id);
    if (!item) throw new CatalogNotFoundError();
    return item;
  }

  private async validateItem(input: CreateCatalogItem, itemId?: string): Promise<void> {
    if (input.categoryId && !(await this.repository.listCategories()).some((category) => category.id === input.categoryId && category.active)) throw new CatalogNotFoundError();
    if (input.itemTypeId && !(await this.repository.listTypes()).some((type) => type.id === input.itemTypeId && type.active)) throw new CatalogNotFoundError();
    if ((input.availabilityMode === "interval_capacity") !== (input.capacity !== null)) throw new CatalogValidationError("Invalid capacity mode");
    const definitions = await this.repository.listFields({ ...(input.itemTypeId ? { itemTypeId: input.itemTypeId } : {}), ...(itemId ? { itemId } : {}) });
    const byId = new Map(definitions.filter((field) => field.active).map((field) => [field.id, field]));
    for (const [fieldId, value] of Object.entries(input.fields)) {
      const definition = byId.get(fieldId);
      if (!definition || !validFieldValue(definition, value)) throw new CatalogValidationError("Invalid field value");
    }
    for (const field of byId.values()) {
      if (field.required && !Object.hasOwn(input.fields, field.id)) throw new CatalogValidationError("Missing required field");
    }
  }

  public async createItem(permissions: readonly IamPermission[], input: CreateCatalogItem) {
    requirePermission(permissions, "crm:catalog:write");
    await this.validateItem(input);
    const now = new Date().toISOString();
    return this.repository.createItem({ ...input, id: randomUUID(), active: true, version: "1", createdAt: now, updatedAt: now });
  }

  public async updateItem(permissions: readonly IamPermission[], id: string, patch: Partial<CreateCatalogItem> & { readonly active?: boolean }, expectedVersion: bigint) {
    requirePermission(permissions, "crm:catalog:write");
    const current = await this.repository.findItem(id);
    if (!current) throw new CatalogNotFoundError();
    if (BigInt(current.version) !== expectedVersion) throw new CatalogVersionConflictError();
    const merged: CreateCatalogItem = {
      kind: patch.kind ?? current.kind,
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      sku: patch.sku === undefined ? current.sku : patch.sku,
      categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
      itemTypeId: patch.itemTypeId === undefined ? current.itemTypeId : patch.itemTypeId,
      price: patch.price ?? current.price,
      currency: patch.currency ?? current.currency,
      availabilityMode: patch.availabilityMode ?? current.availabilityMode,
      capacity: patch.capacity === undefined ? current.capacity : patch.capacity,
      locksAdvisor: patch.locksAdvisor ?? current.locksAdvisor,
      fields: patch.fields ?? current.fields,
    };
    await this.validateItem(merged, id);
    const updated = await this.repository.updateItem({ item: { ...current, ...merged, active: patch.active ?? current.active, version: String(expectedVersion + 1n), updatedAt: new Date().toISOString() }, expectedVersion });
    if (!updated) throw new CatalogVersionConflictError();
    return updated;
  }

  public async adjustStock(permissions: readonly IamPermission[], input: { readonly itemId: string; readonly delta: number; readonly reason: string; readonly actorMemberId: string; readonly idempotencyKey: string }) {
    requirePermission(permissions, "crm:catalog:stock");
    const item = await this.repository.findItem(input.itemId);
    if (!item) throw new CatalogNotFoundError();
    if (item.availabilityMode !== "stock") throw new CatalogValidationError("Only stock items accept movements");
    return this.repository.adjustStock(input);
  }
}
