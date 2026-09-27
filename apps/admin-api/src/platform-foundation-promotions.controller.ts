import { BadRequestException, ConflictException, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, Headers, Req, Res, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PlatformFoundationPromotionResponseSchema } from "@quantum-crm/contracts";
import { DatabaseUnavailableError } from "@quantum-crm/database";
import { PlatformFoundationPromotionValidationError, type PlatformFoundationPromotion, type PlatformFoundationPromotionRepository } from "@quantum-crm/platform-domain";

import { platformAuthContext, RequirePlatformPermission } from "./platform-security.js";

export const PLATFORM_FOUNDATION_PROMOTION_REPOSITORY = Symbol("PLATFORM_FOUNDATION_PROMOTION_REPOSITORY");

interface HeaderResponse { readonly setHeader: (name: string, value: string) => void; }
function idempotencyKey(value: string | undefined): string { if (!value || !/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) throw new BadRequestException(); return value; }
function contract(promotion: PlatformFoundationPromotion) {
  return { id: promotion.id, releaseId: promotion.releaseId, requestedByOperatorId: promotion.requestedByOperatorId, status: promotion.status, attempt: promotion.attempt, version: promotion.version.toString(), failureCode: promotion.failureCode, createdAt: promotion.createdAt.toISOString(), updatedAt: promotion.updatedAt.toISOString() };
}

@Controller("api/v1/releases")
export class PlatformFoundationPromotionsController {
  public constructor(@Inject(PLATFORM_FOUNDATION_PROMOTION_REPOSITORY) private readonly promotions: PlatformFoundationPromotionRepository) {}

  @Post(":releaseId/foundation-promotions")
  @HttpCode(202)
  @RequirePlatformPermission("deployments:execute")
  public async request(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Param("releaseId", new ParseUUIDPipe()) releaseId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const auth = platformAuthContext(request);
    try {
      const result = await this.promotions.request({ id: randomUUID(), releaseId, requestedByOperatorId: auth.principal.id, idempotencyKey: idempotencyKey(rawIdempotencyKey), correlationId: auth.correlationId });
      response.setHeader("ETag", `"${result.promotion.version.toString()}"`);
      response.setHeader("Location", `/api/v1/releases/${releaseId}/foundation-promotions/${result.promotion.id}`);
      return PlatformFoundationPromotionResponseSchema.parse({ schemaVersion: "platform-foundation-promotion/v1", data: contract(result.promotion), meta: { idempotentReplay: result.idempotentReplay } });
    } catch (error) {
      if (error instanceof PlatformFoundationPromotionValidationError) throw new ConflictException();
      if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
      throw error;
    }
  }
}
