import { Controller, Get, Req } from "@nestjs/common";
import { createPlatformOperatorSelf, type PlatformOperatorSelf } from "@quantum-crm/contracts";

import { platformAuthContext } from "./platform-security.js";

@Controller("api/v1/operators")
export class OperatorsController {
  @Get("me")
  public me(@Req() request: Parameters<typeof platformAuthContext>[0]): PlatformOperatorSelf {
    const context = platformAuthContext(request);
    return createPlatformOperatorSelf({
      id: context.principal.id,
      permissions: context.permissions as PlatformOperatorSelf["data"]["permissions"],
      authorizationRevision: context.authorizationRevision,
      authenticatedAt: context.authenticatedAt,
    });
  }
}
