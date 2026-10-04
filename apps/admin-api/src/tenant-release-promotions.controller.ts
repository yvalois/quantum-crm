import {
  BadRequestException, Body, ConflictException, Controller, Headers, HttpCode, HttpException, Inject, Param,
  ParseUUIDPipe, Post, Req, Res, ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestTenantReleasePromotionSchema, TenantReleasePromotionResponseSchema, type TenantReleasePromotionContract } from "@quantum-crm/contracts";
import { DatabaseUnavailableError } from "@quantum-crm/database";
import { TenantReleasePromotionConflictError, TenantReleasePromotionService, TenantReleasePromotionValidationError, type TenantReleasePromotion, type TenantReleasePromotionRepository } from "@quantum-crm/platform-domain";
import { platformAuthContext, RequirePlatformPermission } from "./platform-security.js";

export const TENANT_RELEASE_PROMOTION_REPOSITORY = Symbol("TENANT_RELEASE_PROMOTION_REPOSITORY");
interface HeaderResponse { readonly setHeader: (name: string, value: string) => void; }
function etag(version: bigint): string { return `"${version.toString()}"`; }
function expectedVersion(value: string | undefined): bigint {
  const match = value ? /^"([1-9][0-9]*)"$/u.exec(value) : null;
  if (!match?.[1]) throw new HttpException("Precondition Required", 428);
  return BigInt(match[1]);
}
function idempotency(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) throw new BadRequestException();
  return value;
}
function contract(promotion: TenantReleasePromotion): TenantReleasePromotionContract {
  return {
    id: promotion.id, tenantProfileId: promotion.tenantProfileId, previousReleaseId: promotion.previousReleaseId,
    targetReleaseId: promotion.targetReleaseId, requestedByOperatorId: promotion.requestedByOperatorId,
    status: promotion.status, currentStep: promotion.currentStep, attempt: promotion.attempt,
    version: promotion.version.toString(), failureCode: promotion.failureCode,
    createdAt: promotion.createdAt.toISOString(), updatedAt: promotion.updatedAt.toISOString(),
  };
}

@Controller("api/v1/tenant-profiles")
export class TenantReleasePromotionsController {
  public constructor(@Inject(TENANT_RELEASE_PROMOTION_REPOSITORY) repository: TenantReleasePromotionRepository) {
    this.promotions = new TenantReleasePromotionService(repository);
  }
  private readonly promotions: TenantReleasePromotionService;

  @Post(":id/release-promotions")
  @HttpCode(202)
  @RequirePlatformPermission("deployments:execute")
  public async request(
    @Req() request: Parameters<typeof platformAuthContext>[0], @Param("id", new ParseUUIDPipe()) tenantProfileId: string,
    @Headers("if-match") ifMatch: string | undefined, @Headers("idempotency-key") rawKey: string | undefined,
    @Body() body: unknown, @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const auth = platformAuthContext(request); const parsed = RequestTenantReleasePromotionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const result = await this.promotions.request({
        id: randomUUID(), tenantProfileId, targetReleaseId: parsed.data.targetReleaseId,
        requestedByOperatorId: auth.principal.id, idempotencyKey: idempotency(rawKey), correlationId: auth.correlationId,
        expectedTenantVersion: expectedVersion(ifMatch),
      });
      response.setHeader("Location", `/api/v1/tenant-profiles/${tenantProfileId}/release-promotions/${result.promotion.id}`);
      response.setHeader("X-Tenant-Profile-ETag", etag(result.tenantVersion));
      return TenantReleasePromotionResponseSchema.parse({ schemaVersion: "tenant-release-promotion/v1", data: contract(result.promotion), meta: { idempotentReplay: result.idempotentReplay } });
    } catch (error) {
      if (error instanceof TenantReleasePromotionConflictError) throw new ConflictException();
      if (error instanceof TenantReleasePromotionValidationError) throw new ConflictException();
      if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
      throw error;
    }
  }
}
