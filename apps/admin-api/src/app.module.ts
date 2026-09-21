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
import { PLATFORM_RELEASE_SERVICE, ReleasesController } from "./releases.controller.js";
import {
  INFRASTRUCTURE_SERVER_SERVICE,
  InfrastructureServersController,
} from "./infrastructure-servers.controller.js";
import {
  TENANT_PROFILE_SERVICE,
  TENANT_PROVISIONING_SERVICE,
  TenantProfilesController,
} from "./tenant-profiles.controller.js";
import {
  InfrastructureServerService,
  PlatformReleaseService,
  TenantProfileService,
  TenantProvisioningService,
} from "@quantum-crm/platform-domain";

@Module({})
export class AppModule {
  public static register(
    database: PlatformPostgresDatabase,
    oidcAccessTokenVerifier: OidcAccessTokenVerifier,
    authPolicy: PlatformAuthPolicy,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        InfrastructureServersController,
        OperatorsController,
        ReleasesController,
        TenantProfilesController,
      ],
      providers: [
        { provide: POSTGRES_DATABASE, useValue: database },
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: oidcAccessTokenVerifier },
        { provide: PLATFORM_MEMBERSHIPS, useValue: database.memberships },
        { provide: PLATFORM_AUTH_POLICY, useValue: authPolicy },
        {
          provide: INFRASTRUCTURE_SERVER_SERVICE,
          useFactory: () => new InfrastructureServerService(database.infrastructureServers),
        },
        {
          provide: TENANT_PROFILE_SERVICE,
          useFactory: () => new TenantProfileService(database.tenantProfiles),
        },
        {
          provide: TENANT_PROVISIONING_SERVICE,
          useFactory: () => new TenantProvisioningService(database.provisioningOperations),
        },
        {
          provide: PLATFORM_RELEASE_SERVICE,
          useFactory: () => new PlatformReleaseService(database.releases),
        },
        { provide: APP_GUARD, useClass: PlatformAuthenticationGuard },
        { provide: APP_GUARD, useClass: PlatformAuthorizationGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
