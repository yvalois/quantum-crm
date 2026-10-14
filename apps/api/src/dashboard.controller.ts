import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  DashboardLayoutSchema,
  DashboardPeriodSchema,
  DashboardPreferenceResponseSchema,
  DashboardSnapshotSchema,
} from "@quantum-crm/contracts";
import { DashboardService } from "@quantum-crm/domain";
import { crmAuthContext } from "./crm-security.js";

export const DASHBOARD_SERVICE = Symbol("DASHBOARD_SERVICE");

@Controller("/api/v1/reporting/dashboard")
export class DashboardController {
  public constructor(@Inject(DASHBOARD_SERVICE) private readonly service: DashboardService) {}

  @Get("snapshot")
  @Header("Cache-Control", "no-store")
  public async snapshot(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query("period") rawPeriod?: string,
  ) {
    const period = DashboardPeriodSchema.safeParse(rawPeriod ?? "all");
    if (!period.success) throw new HttpException("Invalid period", HttpStatus.BAD_REQUEST);
    const context = crmAuthContext(request);
    return DashboardSnapshotSchema.parse({
      data: await this.service.snapshot(
        { memberId: context.principal.id, scope: context.commercialScope },
        context.permissions,
        period.data,
      ),
    });
  }

  @Get("preferences")
  @Header("Cache-Control", "no-store")
  public async preferences(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    return DashboardPreferenceResponseSchema.parse({
      data: await this.service.preferences(crmAuthContext(request).principal.id),
    });
  }

  @Put("preferences")
  @Header("Cache-Control", "no-store")
  public async save(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("if-match") rawVersion: string | undefined,
    @Body() input: unknown,
  ) {
    const layout = DashboardLayoutSchema.safeParse(input);
    const match = rawVersion ? /^"(0|[1-9][0-9]*)"$/u.exec(rawVersion) : null;
    if (!layout.success) throw new HttpException("Invalid layout", HttpStatus.BAD_REQUEST);
    if (!match?.[1]) throw new HttpException("If-Match required", HttpStatus.PRECONDITION_REQUIRED);
    const result = await this.service.savePreferences(
      crmAuthContext(request).principal.id,
      layout.data,
      BigInt(match[1]),
    );
    if (!result) throw new HttpException("Dashboard was changed", HttpStatus.PRECONDITION_FAILED);
    return DashboardPreferenceResponseSchema.parse({ data: result });
  }
}
