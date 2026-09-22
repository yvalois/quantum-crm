import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  type CrmAuthPolicy,
  type OidcAccessTokenVerifier,
} from "@quantum-crm/auth";
import { POSTGRES_DATABASE, type CrmPostgresDatabase } from "@quantum-crm/database";
import { IamMemberService } from "@quantum-crm/domain";

import {
  CrmAuthenticationGuard,
  CrmAuthorizationGuard,
  CRM_AUTH_POLICY,
  CRM_MEMBERSHIPS,
} from "./crm-security.js";
import { HealthController } from "./health.controller.js";
import { IAM_MEMBER_SERVICE, MembersController } from "./members.controller.js";
import { ProblemDetailsFilter } from "./problem-details.filter.js";

@Module({})
export class AppModule {
  public static register(
    database: CrmPostgresDatabase,
    verifier: OidcAccessTokenVerifier,
    policy: CrmAuthPolicy,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, MembersController],
      providers: [
        { provide: POSTGRES_DATABASE, useValue: database },
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: CRM_MEMBERSHIPS, useValue: database.memberships },
        { provide: CRM_AUTH_POLICY, useValue: policy },
        { provide: IAM_MEMBER_SERVICE, useFactory: () => new IamMemberService(database.members) },
        { provide: APP_GUARD, useClass: CrmAuthenticationGuard },
        { provide: APP_GUARD, useClass: CrmAuthorizationGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
