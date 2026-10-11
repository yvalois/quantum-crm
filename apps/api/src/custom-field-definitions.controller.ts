import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
} from "@nestjs/common";
import {
  CustomFieldDefinitionListQuerySchema,
  CustomFieldDefinitionListResponseSchema,
} from "@quantum-crm/contracts";
import {
  CustomFieldDefinitionService,
  CustomFieldDefinitionValidationError,
  IamAuthorizationError,
  type IamPermission,
} from "@quantum-crm/domain";
import { crmAuthContext } from "./crm-security.js";

export const CUSTOM_FIELD_DEFINITION_SERVICE = Symbol("CUSTOM_FIELD_DEFINITION_SERVICE");

@Controller("api/v1/custom-field-definitions")
export class CustomFieldDefinitionsController {
  public constructor(
    @Inject(CUSTOM_FIELD_DEFINITION_SERVICE)
    private readonly service: CustomFieldDefinitionService,
  ) {}

  @Get()
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0], @Query() query: unknown) {
    const parsed = CustomFieldDefinitionListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    const auth = crmAuthContext(request);
    try {
      // The service selects the required permission from the validated model and denies by default.
      const result = await this.service.list(
        auth.permissions as readonly IamPermission[],
        parsed.data,
      );
      return CustomFieldDefinitionListResponseSchema.parse({
        data: result.items,
        page: { nextCursor: result.nextCursor },
      });
    } catch (error) {
      if (error instanceof IamAuthorizationError) throw new ForbiddenException();
      if (error instanceof CustomFieldDefinitionValidationError) throw new BadRequestException();
      throw error;
    }
  }
}
