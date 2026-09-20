import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { OIDC_ACCESS_TOKEN_VERIFIER, type OidcAccessTokenVerifier } from "@quantum-crm/auth";
import type { PlatformAuthPolicy } from "@quantum-crm/auth";
import { POSTGRES_DATABASE, type PlatformPostgresDatabase } from "@quantum-crm/database";

import { HealthController } from "./health.controller.js";
import { OperatorsController } from "./operators.controller.js";
import {
  PLATFORM_AUTH_POLICY,
  PLATFORM_MEMBERSHIPS,
  PlatformAuthenticationGuard,
  PlatformAuthorizationGuard,
} from "./platform-security.js";
import { ProblemDetailsFilter } from "./problem-details.filter.js";

@Module({})
export class AppModule {
  public static register(
    database: PlatformPostgresDatabase,
    oidcAccessTokenVerifier: OidcAccessTokenVerifier,
    authPolicy: PlatformAuthPolicy,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, OperatorsController],
      providers: [
        { provide: POSTGRES_DATABASE, useValue: database },
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: oidcAccessTokenVerifier },
        { provide: PLATFORM_MEMBERSHIPS, useValue: database.memberships },
        { provide: PLATFORM_AUTH_POLICY, useValue: authPolicy },
        { provide: APP_GUARD, useClass: PlatformAuthenticationGuard },
        { provide: APP_GUARD, useClass: PlatformAuthorizationGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
