import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, Inject,
  NotFoundException, Param, Patch, Post, PreconditionFailedException, Query, Req,
} from "@nestjs/common";
import {
  AdjustCatalogStockSchema, CatalogCategoryListResponseSchema, CatalogFieldListResponseSchema,
  CatalogItemListQuerySchema, CatalogItemListResponseSchema, CatalogItemResponseSchema,
  CatalogTypeListResponseSchema, CreateCatalogCategorySchema, CreateCatalogFieldSchema,
  CreateCatalogItemSchema, CreateCatalogTypeSchema, UpdateCatalogItemSchema,
} from "@quantum-crm/contracts";
import {
  CatalogIdempotencyConflictError, CatalogNotFoundError, CatalogService,
  CatalogStockConflictError, CatalogValidationError, CatalogVersionConflictError,
  type IamPermission,
} from "@quantum-crm/domain";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const CATALOG_SERVICE = Symbol("CATALOG_SERVICE");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const idempotencyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

function uuid(value: string): string {
  if (!uuidPattern.test(value)) throw new BadRequestException();
  return value;
}
function permissions(request: Parameters<typeof crmAuthContext>[0]): readonly IamPermission[] {
  return crmAuthContext(request).permissions as readonly IamPermission[];
}
function mapError(error: unknown): never {
  if (error instanceof CatalogNotFoundError) throw new NotFoundException();
  if (error instanceof CatalogVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof CatalogStockConflictError || error instanceof CatalogIdempotencyConflictError) throw new ConflictException();
  if (error instanceof CatalogValidationError) throw new BadRequestException(error.message);
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "23505" || error.code === "23P01") throw new ConflictException();
    if (error.code === "23514" || error.code === "23503") throw new BadRequestException();
  }
  throw error;
}

@Controller("api/v1/catalog")
export class CatalogController {
  public constructor(@Inject(CATALOG_SERVICE) private readonly service: CatalogService) {}

  @Get("categories")
  @RequireCrmPermission("crm:catalog:read")
  public async categories(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try { return CatalogCategoryListResponseSchema.parse({ data: await this.service.listCategories(permissions(request)) }); }
    catch (error) { return mapError(error); }
  }

  @Post("categories")
  @RequireCrmPermission("crm:catalog:write")
  public async createCategory(@Req() request: Parameters<typeof crmAuthContext>[0], @Body() body: unknown) {
    const parsed = CreateCatalogCategorySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try { return { data: await this.service.createCategory(permissions(request), parsed.data.name, parsed.data.parentId) }; }
    catch (error) { return mapError(error); }
  }

  @Get("types")
  @RequireCrmPermission("crm:catalog:read")
  public async types(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try { return CatalogTypeListResponseSchema.parse({ data: await this.service.listTypes(permissions(request)) }); }
    catch (error) { return mapError(error); }
  }

  @Post("types")
  @RequireCrmPermission("crm:catalog:write")
  public async createType(@Req() request: Parameters<typeof crmAuthContext>[0], @Body() body: unknown) {
    const parsed = CreateCatalogTypeSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try { return { data: await this.service.createType(permissions(request), parsed.data.name, parsed.data.description) }; }
    catch (error) { return mapError(error); }
  }

  @Get("fields")
  @RequireCrmPermission("crm:catalog:read")
  public async fields(@Req() request: Parameters<typeof crmAuthContext>[0], @Query("itemTypeId") itemTypeId?: string, @Query("itemId") itemId?: string) {
    if (itemTypeId) uuid(itemTypeId);
    if (itemId) uuid(itemId);
    try { return CatalogFieldListResponseSchema.parse({ data: await this.service.listFields(permissions(request), { ...(itemTypeId ? { itemTypeId } : {}), ...(itemId ? { itemId } : {}) }) }); }
    catch (error) { return mapError(error); }
  }

  @Post("fields")
  @RequireCrmPermission("crm:catalog:write")
  public async createField(@Req() request: Parameters<typeof crmAuthContext>[0], @Body() body: unknown) {
    const parsed = CreateCatalogFieldSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try { return { data: await this.service.createField(permissions(request), {
      itemTypeId: parsed.data.itemTypeId ?? null, itemId: parsed.data.itemId ?? null,
      key: parsed.data.key, label: parsed.data.label, description: parsed.data.description,
      valueType: parsed.data.valueType, options: parsed.data.options,
      required: parsed.data.required, sortOrder: parsed.data.sortOrder,
    }) }; }
    catch (error) { return mapError(error); }
  }

  @Get("items")
  @RequireCrmPermission("crm:catalog:read")
  public async items(@Req() request: Parameters<typeof crmAuthContext>[0], @Query() query: unknown) {
    const parsed = CatalogItemListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    try { return CatalogItemListResponseSchema.parse({ data: await this.service.listItems(permissions(request), parsed.data) }); }
    catch (error) { return mapError(error); }
  }

  @Get("items/:itemId")
  @RequireCrmPermission("crm:catalog:read")
  public async item(@Req() request: Parameters<typeof crmAuthContext>[0], @Param("itemId") itemId: string) {
    try { return CatalogItemResponseSchema.parse({ data: await this.service.findItem(permissions(request), uuid(itemId)) }); }
    catch (error) { return mapError(error); }
  }

  @Post("items")
  @RequireCrmPermission("crm:catalog:write")
  public async createItem(@Req() request: Parameters<typeof crmAuthContext>[0], @Body() body: unknown) {
    const parsed = CreateCatalogItemSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try { return CatalogItemResponseSchema.parse({ data: await this.service.createItem(permissions(request), parsed.data) }); }
    catch (error) { return mapError(error); }
  }

  @Patch("items/:itemId")
  @RequireCrmPermission("crm:catalog:write")
  public async updateItem(@Req() request: Parameters<typeof crmAuthContext>[0], @Param("itemId") itemId: string,
    @Headers("if-match") ifMatch: string | undefined, @Body() body: unknown) {
    const parsed = UpdateCatalogItemSchema.safeParse(body);
    if (!parsed.success || !ifMatch || !/^"[1-9][0-9]*"$/u.test(ifMatch)) throw new BadRequestException();
    try { return CatalogItemResponseSchema.parse({ data: await this.service.updateItem(permissions(request), uuid(itemId), parsed.data, BigInt(ifMatch.slice(1, -1))) }); }
    catch (error) { return mapError(error); }
  }

  @Post("items/:itemId/stock-movements")
  @RequireCrmPermission("crm:catalog:stock")
  public async adjustStock(@Req() request: Parameters<typeof crmAuthContext>[0], @Param("itemId") itemId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() body: unknown) {
    const parsed = AdjustCatalogStockSchema.safeParse(body);
    if (!parsed.success || !idempotencyKey || !idempotencyPattern.test(idempotencyKey)) throw new BadRequestException();
    try { return CatalogItemResponseSchema.parse({ data: await this.service.adjustStock(permissions(request), {
      itemId: uuid(itemId), delta: parsed.data.delta, reason: parsed.data.reason,
      actorMemberId: crmAuthContext(request).principal.id, idempotencyKey,
    }) }); }
    catch (error) { return mapError(error); }
  }
}
